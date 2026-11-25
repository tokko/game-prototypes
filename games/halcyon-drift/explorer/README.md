# Halcyon Drift: Solar System Explorer (milestone 1, Kestrel demo)

A chill sci-fi exploration game: fly an interplanetary carrier, land a tail-first spaceplane on a moon, tip it down,
roll out a dirt bike, ride off ramps for 10 s of low-gravity airtime, sample ice, refine fuel, fly home.
Plain ES modules, three.js r160 from jsDelivr (same pinning as `prototype/`), no build step.

## Run

```
python -m http.server 8791 --directory explorer     # from the repo root
```

Open `http://localhost:8791/` in a Chromium-based browser (WebGL2, internet access for the three.js CDN).
`index.html?autostart=1` skips the title screen. Debug hooks: `window.__game` (`mode`, `teleport(mode, x, z, opts)`,
`setTime(t)`, `world`, `act.*`), `window.__ready` is set after the first rendered frame.

## Flow

1. Title -> **orbit view** at Kestrel (40 km). The carrier *Wayfarer* holds the lander-rover *Prospector* and the spaceplane *Albatross*.
2. `U` undock the spaceplane, `G` begin descent (retrograde burn, powered descent, handover to the surface scene at 14 km).
3. Land tail-first (auto-land `L`), `T` tip the plane to horizontal, `Y` ramp, `B` bike, `E` ride. Or `E` out and walk.
4. Sample ice/regolith (`G`), scan (`F`), refine at a craft (`R`), `O` launch to orbit, `C` dock, `M` plan transfers to any of the six worlds.

## Controls

| Context | Keys |
|---|---|
| Anywhere | `M` system map, `J` journal, `F1`/`H` help, `Esc` close overlay / release mouse |
| Orbit view | `W/S` pitch, `A/D` yaw, `Q/E` roll, `Shift/Ctrl` throttle, `Z` full, `X` cut, `1` pro, `2` retro, `3` radial, `4` free, `5` node; `,` `.` warp, `/` 1x; `U` undock plane, `I` undock lander, `C` dock (< 12 km), `Tab` switch craft, `G` begin/cancel descent, `N` plane engine mode, `P` panels, `K` radiators; mouse drag + wheel = camera |
| Hover flight (Prospector, Albatross tail-down) | `W/S/A/D` move, `Q/E` turn, `Shift/Ctrl` climb (assist) or throttle (manual), `Space` assist on/off, `L` auto-land, `O` launch to orbit, `E` leave craft (landed) |
| Spaceplane on the ground | `T` tip down / stand up, `Y` cargo ramp, `B` deploy/stow bike, `P` solar panels, `K` radiators, `N` engine mode, `V` drill, `R` mini-ISRU refine |
| On foot | `WASD`, `Shift` run, `Space` jump / hold for jetpack, mouse look (click to capture), wheel zoom, `E` enter craft or ride bike, `G` sample, `F` scan, `R` refine, `B/T/Y/V/P/K` act on the nearby plane |
| Bike | `W` throttle, `S` brake/reverse, `A/D` steer, `Shift` boost, `Q` wheelie, `Space` brake; in the air `W/S` pitch, `A/D` roll, `E/Q` yaw; `R` reset upright, `E` dismount |

Every HUD button mirrors a key and works; the map has its own buttons (plan, warp to window, node editor).

Press `M` and select a ship in **Fleet** or click its map marker to target it from the craft you are piloting. The flight HUD shows range and relative speed when both ships orbit the same body. **Plan rendezvous** replaces the piloted ship's maneuver nodes with an intercept and a velocity match roughly 200 m behind the target. Use **Dock** or `C` within 12 km for either of Wayfarer's two ports.

## Space-to-surface transition

Orbit view (`orbit` mode) renders the body as a shader sphere (baked low-res map of the *same* height recipe as the terrain + procedural craters)
and propagates craft on conics. When a landing craft descends below 14 km (and is falling), the terrain scene is
pre-warmed from 48 km (terrain origin fixed at the descent point). The camera keeps its viewing angle and distance as the terrain takes over. Position, velocity and
attitude are carried through the local east/up/south frame (`flight.js: orbitToSurface`); the flat-plane physics adds the
centrifugal term `g_eff = g - v_h^2/R` so the descent trajectory is continuous. Above 16 km an ascent hands back to the orbit view the same way.
The horizon is curved by a `d^2/2R` vertex-shader drop on terrain, scatter and shadow casters.

## Patched conics (real, not scripted)

`system.js` + `orbits.js` (adapted from the prototype): bodies on rails with spheres of influence (planets, giants, moons: Sun >
Tamber > Kestrel/Glaciera/Sable, Ymir > Nyth, Pyra, Verdant Prime, Aethel), conic-to-conic prediction across SOI enter/exit/impact with
chained maneuver nodes (`predict`). The map draws every segment, SOI crossings, nodes, periapses and closest approach to the selected body.
The node editor (pro/normal/radial, time shift, add at Pe/Ap/+10 min, delete, warp to node, auto-burn toggle) works on whichever conic a node sits on,
including after an SOI change. **Plan transfer** (`planner.js`) builds the chain automatically: moon-phase and launch-window search, ejection node, Lambert mid-course correction on
entering the common frame, a second correction inside the target giant's SOI for moons, and a capture burn at periapsis. All 30 ordered pairs of destinations plan and fly to a circular capture orbit
in headless checks. Nodes execute at their time: delta-v is applied exactly at the node (what the prediction assumes), propellant by the rocket equation, flame for a few seconds.
A future automatic slingshot planner would reuse `predict` / `closestApproach` as its cost function, searching departure time + flyby body and returning a node chain like `planTransfer` does.

## Craft: masses, Isp, thrust, tanks, delta-v

| Craft | Dry | Propellant | Engine(s) | Thrust | Isp | dv (full) |
|---|---|---|---|---|---|---|
| Wayfarer carrier (nuclear-thermal) | 42,000 kg | 70,000 kg LH2 | NTR | 300 kN | 900 s | 5,408 m/s with both craft docked (152.8 t wet, 2.0 m/s2); 8,657 m/s alone |
| Prospector survey rover / lander (methalox, O/F 3.6; was the Heron) | 4,800 kg | 1,520 kg CH4 + 5,480 kg LOX | 1 throttleable | 45 kN | 340 s | 2,994 m/s (11.8 t wet, TWR 3.2 on Kestrel) |
| Albatross spaceplane, rocket mode | 9,000 kg (incl. 300 kg bike, mini-ISRU) | 4,300 kg CH4 + 13,500 kg LOX | closed-cycle | 140 kN | 360 s | 3,359 m/s rocket only (29.0 t wet, TWR 4.1 on Kestrel); the surplus methane feeds the jets |
| Albatross, nuclear mode | same | 2,200 kg LH2 | small NTR | 25 kN | 850 s | 929 m/s (1,823 m/s once the rocket propellant is spent); TWR 1.0 so orbit only |
| Albatross, air-breathing jet | same | CH4 only | jet | 90 kN at sea level, falls with density^0.8, dies at Mach 6.5 | 3,500 s | ~3,640 m/s equivalent, atmosphere only (auto-selected there) |

Carrier tank sizing: capacity with both craft docked = 5,408 m/s = 1.26 x the hardest ideal leg (Pyra <-> Nyth 4,300 m/s), but far short of a grand tour, so refuelling
matters: the lander/plane refine ice into hydrogen cargo (`R`), then a docked **Transfer H2** button moves it to the carrier. Planned (patched-conic) legs cost about 5 to 40% more than ideal because of moon-phase and
launch-window compromises; the worst one (Pyra -> Nyth) needs 5,298 m/s, still within the carrier's 5,408 m/s.

### Leg delta-v (m/s, departure + capture)

Ideal (two-level Hohmann, patched conic estimate shown in the map before you commit):

| from \ to | Verdant | Kestrel | Pyra | Nyth | Aethel | Glaciera |
|---|---|---|---|---|---|---|
| Verdant | - | 2293 | 2489 | 2854 | 1826 | 2327 |
| Kestrel | 2293 | - | 3953 | 1055 | 1426 | 533 |
| Pyra | 2489 | 3953 | - | 4300 | 3201 | 4031 |
| Nyth | 2854 | 1055 | 4300 | - | 2096 | 1041 |
| Aethel | 1826 | 1426 | 3201 | 2096 | - | 1425 |
| Glaciera | 2327 | 533 | 4031 | 1041 | 1425 | - |

Planned by the node planner (chain of real nodes, what the carrier actually burns):

| from \ to | Verdant | Kestrel | Pyra | Nyth | Aethel | Glaciera |
|---|---|---|---|---|---|---|
| Verdant | - | 3149 | 2630 | 3414 | 1943 | 3184 |
| Kestrel | 2465 | - | 4270 | 1792 | 1677 | 567 |
| Pyra | 2573 | 5236 | - | 5298 | 3301 | 4969 |
| Nyth | 2984 | 1439 | 4425 | - | 2273 | 1726 |
| Aethel | 1876 | 1598 | 3560 | 2164 | - | 2077 |
| Glaciera | 2589 | 566 | 4278 | 1428 | 1710 | - |

The spaceplane's nuclear mode does Kestrel <-> Glaciera alone (planned 567 m/s vs 929 m/s available; flown in a headless check using 1,383 kg of 2,200 kg LH2).

### Landing + ascent per body (estimate, m/s)

Kestrel 1,742 and Glaciera 1,856 (land + ascent, whole round trip) are within both Prospector (2,994) and Albatross rocket mode (3,359). Verdant Prime 4,949, Pyra 4,491, Aethel 3,704 and Nyth 3,553 exceed what a
pure rocket round trip allows, but the return leg alone is what matters once the craft has been refuelled on the surface (ISRU), so the ascent budget below is computed from a FULL surface refuel (`src/ascent.js`, also shown in the map's body info).

### Can every destination be left to orbit after a full surface refuel?

Airless worlds: vertical launch (nose up, engines down at the ground, thrusting up and then pitching over in a gravity turn). Atmospheric worlds: the spaceplane takes off horizontally on its wheels,
climbs on air-breathing jets (Isp 3,500 s, thrust falling with air density; in the flown model they top out near Mach 2.1 at 9 to 12 km and add about 750 m/s), then switches to the closed-cycle rocket to circularise. Heron is a blunt, draggy rocket, no wings, rocket ascent only.
Need = circular speed + gravity loss (0.55 g x burn time) + drag loss on atmospheric worlds + 20 m/s margin.

| Body | Prospector need / capacity (m/s) | Prospector reaches orbit | Albatross ascent | Albatross reaches orbit |
|---|---|---|---|---|
| Kestrel (airless) | 663 / 2,999 | yes (+352%) | vertical launch, 648 / 3,359 m/s | yes (+418%) |
| Glaciera (airless) | 736 / 2,999 | yes (+307%) | vertical launch, 721 / 3,359 m/s | yes (+366%) |
| Verdant Prime | 2,672 / 2,999 | yes (+12%) | jets 750 m/s then rocket about 2,880 m/s (flown, not the 1,556 ideal): 4,229 kg CH4 + 12,301 kg LOX of 4,300 / 13,500 | yes, marginal (+2% budget, +5% flown) |
| Pyra | 2,413 / 2,999 | yes (+24%) | jets 750 m/s then rocket 2,422 m/s (estimate): 3,854 kg CH4 + 10,951 kg LOX | yes (+12%) |
| Nyth | 1,862 / 2,999 | yes (+61%) | jets 750 m/s then rocket 1,570 m/s (estimate): 3,012 kg CH4 + 7,919 kg LOX | yes (+43%) |
| Aethel | 1,948 / 2,999 | yes (+54%) | jets 750 m/s then rocket 1,729 m/s (estimate): 3,185 kg CH4 + 8,541 kg LOX | yes (+35%) |

Tuning applied: the Albatross tanks were enlarged (see 'Atmospheric ascent test') after the first unbroken Verdant run showed the original budget was optimistic. Verdant's row is validated by a flown run (below); the other atmospheric rows are the same arithmetic, not flown. Only Kestrel's vertical launch and Verdant's runway climb are flown. The Heron rows are budget estimates (no atmospheric lander ascent flown).

## Spaceplane (Albatross)

Angular lifting body with cranked delta wings, twin canted tails, three engine modes (`N` cycles auto / jet / rocket / nuclear; auto uses jet in air, rocket for landings and ascents, nuclear for orbital moves).
**No VTOL thrusters**: on airless worlds it flips retrograde and brakes tail-first on the main engines (suicide-burn style auto-land), touches down on four tail legs that unfold around the engines, then `T`
makes the gear tip it down to horizontal (wheels deploy first, tail legs fold, about 6 s, controlled pivot), after which the cargo ramp lowers and the bike rolls out. `T` again (ramp up, bike stowed) stands it up for a vertical launch (nose up, engines down on the ground, thrusting up then pitching over into a gravity turn); tail-first applies only to the landing descent.
Retractable solar panels (fold-out, `P`) charge a battery; the mini drill (`V`) and mini-ISRU (`R`) draw power and make heat that the swing-out radiators (`K`) reject. Overheating or an empty battery stops those systems (never the player).
### Drag and reentry heating (all craft)

`aero.js` has one drag + skin-temperature model used in both scenes, so the orbit-to-surface handover is continuous: ballistic coefficient beta (Prospector, formerly the Heron, 240 kg/m2, blunt and draggy with no lift;
Albatross 640, streamlined; Wayfarer 1,400) gives drag decel = rho v^2 / (2 beta), so each craft has a terminal velocity sqrt(2 g beta / rho). Stagnation heat flux is 1.7e-4 sqrt(rho / nose radius) v^3 (W/m2), the skin
relaxes towards its radiative equilibrium temperature (0.85 emissivity) with a 5 to 12 s thermal lag (game-scaled; real entries last minutes). A bright plasma shell with a stretched wake hugs the leading side from about 800 K, and the HUD shows SKIN temperature and percentage of the limit (Heron 2,300 K, Albatross 1,900 K, Wayfarer 1,600 K).
It is forgiving: a warning at 80% of the limit, then slowly degrading damage above it (up to 45% thrust loss), never an instant kill; panels and radiators are force-retracted as soon as the airstream glows or dynamic pressure is high.
The orbit simulator switches to stepped dynamics at the atmospheric interface of any atmospheric body (the rails event fires at the top of the shell). Kestrel itself is airless, so there is no atmosphere at the default site.
Verified by temporarily giving Kestrel an atmosphere from the browser console (no new test world): a lander entering at 2.6 km/s decelerates from 2,600 m/s to terminal speed, crosses the 14 km hand-over into the surface scene with speed and skin temperature continuous, at 57 fps.
Wing lift/stall and jet thrust falloff in `aero.js` are used by the ascent budget and engine selection; the surface scene has no wing-borne flight yet.

## Authored models (GLB)

`assets/models/astronaut.glb`, `dirtbike.glb` and `albatross.glb` replace the procedural astronaut, bike and spaceplane (the procedural builders in `models.js` remain only as a per-model fallback if a file fails to load).
`src/glbmodels.js` preloads all three behind the title screen ("Loading models... n%") and wraps each in the same API as the procedural models.
- **Astronaut**: skinned female character driven by an `AnimationMixer` with crossfades: `idle`, `walk_sexy` (the default walk), `run`, a split low-g jump (`jump_start`, looping `jump_float` while airborne, `jump_land` on touchdown) and `ride`.
  Clip playback is scaled by ground speed against each clip's natural speed (walk 1.3 m/s, run 4 m/s; clamped), and the game's on-foot speeds were lowered to walk 2.2 m/s and run 5.5 m/s so the feet do not skate. On the bike she is parented under the bike root with an identity transform (the `ride` clip carries the hips), with a procedural spine roll and twist for lean and steer. The `Jet` material glows while jetting.
- **Dirt bike**: fork steer, front-fork compression, rear swingarm travel, wheel spin and shock tracking drive the named nodes (`bike_fork`, `bike_front_susp`, `bike_swingarm`, `bike_front_wheel`, `bike_rear_wheel`, `bike_shock_*`).
- **Albatross**: gear, tail legs, ramp, panels and radiators are driven through the baked clips (clip time = deploy fraction x 2 s); elevons and rudders deflect up to 25 degrees with the flight controls (rudder sign checked against the hinge axes); plumes sit on `plume_main_L/R` and `plume_ntr`; the stance rig (nose-up vertical stance on the four tail pads at z = 9.9, tip-down about the pad line) uses the new pad positions and COM. The same model is used docked on the carrier.
- Rendering: materials get the game's CSM/curvature hook, white albedos are scaled to 0.66 and envMap to 0.55 so they do not clip under sun plus bloom. The plane skips shadow casting for lamps and parts under 0.9 m (draw calls times four cascades); that restored 57 fps.
- Not wired: the landing/taxi/nav light empties (the emissive lamp meshes are used instead), `cargo_bike` (the bike spawns at the ramp foot instead), hand IK on the grips.

## Verdant Prime (phase A of the living worlds)

Reusable systems, each driven by a per-world recipe module plus destinations.js data (Pyra, Nyth, Glaciera and Aethel only need a recipe, a palette and an `atmosphere.scatter` block):
- `src/atmo.js`: Rayleigh + Mie single-scattering model (analytic airmass, Henyey-Greenstein phase) with a GLSL and a CPU copy. Used by the sky dome (stars fade by day, gas giant behind the air is extinguished and tinted), by aerial-perspective and valley-mist fog injected into every lit material through `setupMat` (terrain, scatter, vegetation, models, creatures, particles), by water, and by the sun colour / hemisphere tint (`main.js updateSky`). Inert (`uAOn = 0`) on Kestrel and in orbit.
- `src/bodyview.js`: orbit-view atmosphere shell is now a ray-marched scattering shell (rim glow with a warm sunward edge) and a procedural ocean / continent look driven by `palette.ocean`.
- `src/terrain/verdant.js`: the recipe. Valleys, lake basins at `LAKE = 30 m`, a river polyline carved into the height function (so physics, scatter, vegetation and render agree), a 100 m mesa with the Singing Falls where the river meets the cliff, a mountain backdrop, a runway-flat meadow strip (1,400 m x 124 m at 64 m) with a cleared approach corridor, `waterSurface / waterDepth / waterFlow`, `biome()` (moisture, forest, fungus, shore), pinnacle clusters, POIs (falls, fungus grove, spore basin, a spire).
- `src/terrain/worker.js` + `terrain.js`: the chunk worker also emits a per-vertex water surface grid; the terrain shader has a lush mode (grass, mud, sand, moss-on-rock, forest-floor shading).
- `src/water.js`: per-chunk water meshes (lakes at water level, rivers on their own sloped surface), a water shader (sky and sun reflection with fresnel, depth tint, shoreline and fast-water foam, flowing normal waves) and the waterfall cascade (scrolling foam streaks, spray particle plume at the base).
- `src/flora.js` + `src/vegetation.js`: procedural alien flora with real silhouettes (arching fronds, tubes, lathe caps): lance-palm, veil-umbrella tree, bulb tree, giant umbrella fungus (4 to 60 m, glowing gills at dusk), fungus clusters, shrubs, ferns, grass tufts, spore pods. Instanced, wind-animated in the vertex shader, three streaming classes (big 96 m cells to 1.25 km, small 32 m to 340 m, grass 12 m to 66 m), two LODs and distance thinning, biome-driven placement from the recipe, simple trunk colliders.
- `src/ecology.js`: segmented procedural creatures with procedural gaits: skitters (flee close, scuttle in bursts, 5 species incl. a night glider-moth), grazing herds of striders (graze, wander, walk to the lake to drink, bolt as a group), a few giants, and soaring gliders in flocks (flapping and gliding phases, thermals, banking). Deterministic per cell around the player, day/night bias (night species only appear and glow after dark). Survey: `F` scans the nearest creature and plant species, each new one becomes a journal entry ("Documented by you"); the HUD shows `Species n/24`; glowing spore pods are harvestable with `G`.
- Water gameplay: the astronaut wades (slower) and swims at the surface, the bike stalls in deep water, craft cannot land on water (the autopilot lifts the lander clear and warns, the plane is recovered with a splash warning).

### Verdant Prime look pass (golden hour, headland overlook)
- Default site: the plane lands on a runway-flat meadow (168 m) on a headland. 50 m east of the runway end the plateau ends in a cliff edge overlooking a broad misty valley: the river crosses the plateau, pours off the 100 m Singing Falls (`water.js` Waterfall: a wide sheet with layered streaks, lip foam and ledge bands, a mist plume at the base, a rainbow spray glow when sunlit), two smaller cascades on valley ledges, then meanders to the hero lake. Pinnacle clusters (green-topped, strata-banded) rise out of the valley mist.
- Mountains (`massif()` in `terrain/verdant.js`): domain-warped ridged massifs with sedimentary terraces, 1.1 to 3 km peaks, layered ranges receding into haze, snow/bright caps above `uSnowY`.
- Terrain shader (lush mode in `terrain/terrain.js`): multi-scale meadow colour (greens, yellow-green dry patches, darker lush hollows), tuft and clump variation, small flowers, soil and mud on trails and shorelines, gravelly outcrops, scree, **layered sedimentary strata** by elevation band (tan, grey, rust, pale, dark) with moss on bed ledges and flatter rock, green lower flanks, tundra then rock then snow with altitude, and a triplanar detail normal (soft on meadow, strong bedding relief on rock) near the camera.
- Light: sun starts at 10 degrees on arrival (`sky.goldenStart`, local solar time starts at golden hour) and the day is 3e5 s long, so it stays golden for hours of play; warm haze, a soft tone-map of the sky near the sun, a gentler dusk fungus glow, and patchy valley mist (animated noise banks) that thins as the sun climbs.
- Sky giant: a pale teal/cream temperate giant with longitude-sheared festoons, many soft bands and a cream storm oval (`sky.js` style 1 plus `giantPal` in `destinations.js`), hazed by the atmosphere.
- Orbit view (`bodyview.js`): continents, oceans, deserts, mountain and polar-cap tones from low-frequency noise, a slowly rotating banded cloud deck with soft shadows on the surface, an ocean sun glint and the scattering rim.
- A bloom pre-pass sanitizes NaN/Inf texels (a rogue texel could smear into black blocks through the bloom chain).
- The plane's "Hover assist" label is now "Descent hold" (Albatross, tail-down landings) / "Stability assist" (winged flight); the Prospector keeps "Hover assist".

### Flora / fauna kit (assets/models/verdant/*.glb)
`vegetation.js` and `ecology.js` now render the authored Blender kit instead of the procedural plants and animals (`flora.js` and the segmented creature builders remain only as a per-species fallback when a file fails to load). All eight files are preloaded behind the title screen.
- Flora: each recipe species maps to kit variants with LOD0/LOD1 (`tree_lance` / `tree_umbrella` / `tree_bottle`, `fungus_hero` for the 21 to 60 m giants and `fungus_twin` for mid-size fungi, `fungus_cluster`, `shrub_berry`, `fern_curl`, `bloom_lantern` as the harvestable glowing pod, `grass_clump` / `tuft_clump`). One InstancedMesh per material child; assets are real size so the recipe's `p.sc` is converted to an instance scale per variant. The vertex-colour wind mask is moved to a `wmask` attribute (`vertexColors` off): R sway, G branch phase, B leaf flutter drive the wind shader; materials are cloned per species so trees, shrubs and grass get different amplitudes. Emissive materials (`fungus_gills`, `glow_bits`) are driven from about 5% in daylight to about 3x at dusk (restrained so bloom does not blow out).
- Fauna: skinned GLBs cloned with `SkeletonUtils`, one `AnimationMixer` each, tinted per species. Behaviour picks clips and scales playback by speed over the natural speed: skitter (idle, scurry 1.0, flee 3.4), grazer (idle, walk 1.4, run 7.2, graze, drink at the shore, one-shot startle before the herd bolts), titan (idle, walk 0.8, graze_high, occasional call), flyer (flap about 10, glide about 12, bank clips with the root rolled into the turn). Cost control: creatures beyond their range are hidden, mixers freeze beyond roughly 80 to 260 m, shadows only within 55 m, flyers beyond 700 m glide frozen.
- `rocks.glb` (boulder, slab, standing stone, LOD0/LOD1) now drives the boulder scatter on Verdant (`scatter.js` `kitRocks`), with extra rocks along the streams.

### Verdant visual pass 2 (lushness, golden hour, mountains, water)
- Mountains: `massif()` is a domain-warped ridged multifractal with rounded crests, band-limited per terrain chunk (`setBand(step)` called by `terrain/worker.js`) so distant ranges are smooth massifs instead of aliased needles; physics runs at full detail. Green forested flanks climb to about 900 m, scrubby rock, scree, then bare rock; snow only above 1,950 m.
- Cliffs: rock noise runs in (along-face, height) space on steep ground (no vertical curtains), strata bands are bed-aligned, ledge treads and the scarp lip carry moss and grass, and the scarp itself is rugged (buttresses and gullies that vary with depth, stepped strata) except right at the river so the Singing Falls sheet still hugs the rock.
- River and lake: reaches meander, widen and pinch, banks are irregular and shoal gently ((1 - t^2)^1.5 bed, soft levee), so the waterline follows the terrain; the water shader fades out softly over the shallows, shows silty shallows, breaks the foam into wisps and keeps heavy foam for the falls only.
- Lushness: forest is clustered into groves (noise islands favouring wet ground) plus gallery forest along the rivers; umbrella and bottle trees carry the canopy (lance palms limited to 420 m so their LOD1 sticks no longer dot the plain), tree range is 1.4 to 1.6 km, a full LOD0 pool falls back to LOD1, and the terrain shader paints mottled crown cells on forested ground beyond 35 m. Meadow grass is about 3x denser; stick-like berry shrubs no longer fill the meadows; ledge ferns and shrubs grow on rock steps and the scarp rim.
- Light: the sun now starts 30 degrees left of the overlook view (az 62, el 10) so the arrival shot looks into the low sun: long shadows, warm backlit foliage rim (translucent emissive term in the kit shader), warm sun-side mist and haze (soft-kneed in-scatter so it does not clip), exposure 0.98. Valley mist uses bilinear noise (the nearest-filtered noise texture speckled) and is thinner.
- Cost: vegetation streams each class with its own time slice (the far forest used to starve the grass); fps stays at 55 to 60 at 1600x900 with about 5 M vegetation triangles on screen.

### Verdant fixes (strata, far trees)
- Cliff strata use warped, variable-thickness beds (3 to 9 m, some change character sideways) in greys, browns and tan, with moss only on ledge treads and the scarp lip.
- Far trees: beyond 300 m the umbrella and bottle trees switch to a lumpy crown-blob LOD (mostly canopy on a stub trunk, `blobGeo` in `vegetation.js`) so groves read as full green masses; instance pools are larger and the groves are packed so crowns touch.

## Pyra (volcanic world)
Recipe `terrain/pyra.js`, destination data in `destinations.js` (blocks marked `PYRA begin/end`), effects in `volcanic.js`. Built on the same systems as Verdant.
- Terrain: a basalt headland (runway-flat pad at 150 m, 1.4 km strip, heading along the site axis) ends in a stepped scarp over a lava basin. Five stratovolcanoes (1 to 2.6 km, glowing crater lakes, lava streaks down the flanks), lava rivers that feed an irregular lava lake, band-limited ridged ranges beyond, scoria cones, pressure ridges, basalt spires (reuses the scatter pipeline), boulders. The terrain shader has a volcanic mode (`uLush` 2): near-black basalt, ash drifts, bedded scoria on scarps, obsidian glass patches (glossy), sulphur dusting, and emissive crust cracks (voronoi plates) driven by a per-vertex heat value from the recipe.
- Lava: the Verdant water pipeline draws molten lava (`LAVA_FRAG` in `water.js`): two-phase flow-advected noise, cooling crust plates with bright cracks, emissive HDR (blooms), opaque. Flow vectors come from the recipe, so the flow stays cheap (no simulation).
- Atmosphere: thick orange-red ash haze through the existing scatter model plus a per-world colour tint (`scatter.tint`, `uATint` in `atmo.js`, also tints the orbit-view rim). Sun starts low (9 degrees) through the haze.
- Vents and ash: `volcanic.js` draws ash and smoke columns (sprite columns, glowing at the base) from the five summits and nine fumaroles; near fumaroles also emit particles and sparks.
- Heat shimmer: a screen-space wobble in the existing bloom pre-pass (`gfx.sanitize.uHeat`), driven by proximity to lava, off elsewhere (costs nothing when off).
- Heat hazard: the suit temperature rises with radiant heat near lava (reuses the SKIN bar as `SUIT n C`), warns at 55% and 85% (toast + HUD flag), and an overheat or wading in lava teleports you back to the last safe ground (`suitStep` in `volcanic.js`, `pyraHeat` in `main.js`).
- Flora: a few hardy plants reuse the Verdant kit silhouettes with charred, crystal and ember-glow materials (`WORLD.floraLook`): charred lance snags, obsidian crystal fungi, crystal clusters, ember ferns and pods near vents. No fauna.
- Landing: plane on the runway-flat pad (like Verdant), heavy atmosphere (3.4 atm). POIs: fumarole fields and the Furnace lava lake.
- Orbit view: dark crust with glowing lava veins and seas (emissive, visible on the night side), dark ash clouds, orange rim.

### Pyra review round and shared fixes
- Volcano flows are continuous, tapering orange-to-red ribbons that follow the cone's own gully noise (`coneStreak` in `terrain/pyra.js`; encoded as a negative heat value so the shader draws them as ribbons, not crack-patterned dashes). The terrain aux heat channel is now a warmth field (1 at the lava edge, 0 at 90 m): the shader derives the crust glow from it and a cheap underglow, lit by the screen-space gradient of the warmth so slopes facing the lava catch the bounce. Basalt albedo was lifted a little.
- Pyra orbit view: visible ash-haze rim (`atmosphere.visH` = visual shell thickness, `scatter.rimK` = rim strength), lava veins and seas are veiled towards the limb and softened with noise.
- Atmosphere fix (all atmospheric worlds): the valley-mist integral in `FOG_FRAG` evaluated `exp(-km*dm)` with a large negative `dm` when looking down from altitude, overflowed, and whited out the whole screen between about 3 and 14 km. It now integrates between clamped heights (both exponentials are at most 1). Looking down on Verdant from 8 km was pure white before and shows the terrain now.
- `guideLand` (`flight.js`): the final approach is capped at `1 + 0.2 h` m/s. Light craft no longer arrive at the full braking-curve speed: Kestrel drops from 160 m at 30, 60 and 100% propellant land at 1.2 m/s (plane and lander; before: 3.4, 3.3, 2.8 for the plane).
- Hard landings (`contact` in `flight.js`) no longer teleport the craft to 200 m: they cost hull damage scaled by the impact speed, a moderate one (under 12 m/s) bounces and settles, a severe one stays down on the ground. (An 8.4 m/s drop bounced and settled with 0.21 damage; a 15.4 m/s drop stayed down with 0.42.) Winged-flight crashes (`aeroflight.js recover`) are unchanged.
- Runway landing assist (`aeroflight.js`): approach and flare speeds scale with the wing loading at the local air density (`kv`, 1.0 at the Verdant reference, clamped 0.55 to 1.25). On Pyra (3.4 atm) and with a light craft the old fixed 65 m/s approach floated the plane down the whole runway.

## All six worlds (merge of the parallel builds)
Recipes (`src/terrain/<world>.js`) registered in `RECIPES` in `main.js`; each world's additions are delimited by comments (`PYRA`, `NYTH`, `GLACIERA`, `AETHEL`).
- Kestrel (airless moon), Verdant Prime (lush), Pyra (volcanic, `volcanic.js`), Nyth (bioluminescent twilight forest world, `nythfx.js`, kit recoloured as emissive variants), Glaciera (frozen ocean moon, `iceworld.js`, `iceterrain.js`), Aethel (hollow world: outer shell `terrain/aethel.js`, interior wall `terrain/aethelin.js`, `aethelinterior.js`, the Wisp skiff `skiff.js`; skiff dive through a crater hatch swaps the shell for the interior).
- Shared systems touched by several worlds: `atmo.js` (per-world `scatter.tint` and `scatter.amb`), `terrain/terrain.js` (volcanic mode `uLush` 2, Nyth glow uniforms, Aethel gate hole and strata tint), `vegetation.js` (Pyra `floraLook`, Nyth `kit` styles, crown-blob far LOD), `bodyview.js` (Pyra lava veins and rim, Nyth night-side glow, Aethel pits), `main.js` (all hooks; world switches restore shadows, tint, exposure).
- Debug hooks: `__game.teleport(mode, x, z, {world, craft, flat, alt})`, `__game.aethel` (skiffTo, enterInterior, ...), `__game.atmU`, `__game.suit`.
- Merge notes: the three patches were merged with a three-way merge against the common base (line endings normalised to LF); conflicts were all additive (uniform declarations, RECIPES entries, POI text tables, per-world look hooks) and kept both sides.

## Prospector survey rover (replaces the Heron)
`assets/models/prospector.glb` (45.8k tris; needs `EXT_texture_webp`) is loaded through `glbmodels.js` (`buildProspectorGLB`) and keyed entirely by node and clip names (`art/rover/prospector_nodes.json`): `<name>_hinge` rigs, clips `legs_extend`, `panels_deploy`, `radiators_deploy`, `drill_deploy`, `sensor_raise`, anchors `plume_main_L/R`, `wheel_0..5`, `tail_pad_0..2`, `drill_tip`, `crew_exit`, `dock_port`. The contact geometry (wheel centres, wheel radius, tail pads, centre of mass, dock port) is read from the file's anchors at load time (`buildProspectorGLB`), so a re-export with moved wheels or pads needs no code change. If the file fails to load the procedural Heron model is used (same craft stats, no rover features). The craft stats are the Heron's (4,800 kg dry, 1,520 kg CH4 + 5,480 kg LOX, 45 kN, 340 s), so the ascent and planner reports are unchanged; `LANDER` also gained `battery`, `panelPower`, `radiatorRejection`, `heatCap` (the same power / heat model as the Albatross, `Vessel.stepSystems`) and `driveMax` / `driveAccel`.
- **Orbit and docking:** `I` undocks, `C` docks (scripted approach). Docked it hangs in the rove pose with its roof ring (`dock_port`) against the carrier's lander port; free in orbit it is vertical (nose up, engines aft), everything stowed.
- **Descent and landing:** tail-first powered descent on the main nozzles (`plume_main_L/R`), same guidance as before (`guideLand` with the final-approach cap), aero drag and reentry heating as the lander always had. It stands on the three tail pads on every world. A gentle touch on ground too steep to stand on (over about 29 degrees; rare now that the descent picks a site) no longer counts as a hard landing: it lifts off again and hands control back ("find flatter ground, L to land"). T refuses to tip it down where the wheel plane would be steeper than about 29 degrees.
- **Landing-site search (all powered tail landings: the Prospector and the Albatross on airless worlds, auto-land `L` and the descent assist):** below 3 km above ground, `flight.js` (`findSite`, `siteOk`, `siteGuide`) searches outwards for the nearest patch that is flat enough to tip down on: plane-fit slope under 15 degrees over a 18 m (22 m for the plane) footprint, no pit or boulder (residual under 0.9 m), no water or lava, no hot ground (lava heat), no loaded colliders. The reach is what the sideways acceleration allows over a hover-long diversion (up to 5 km; roughly 1.5 to 5 km on Kestrel and Verdant). The horizontal guidance then flies to it (vertical thrust keeps priority, the sink speed is capped so the descent does not finish before the diversion), a green `LZ` pin appears on the compass with an `LZ <distance>` flag and a beam over the site, and it lands there. If nothing is found within reach it keeps the old behaviour (lands where the track ends) and warns once; the search repeats every 3 s while the reach shrinks with altitude.
- **Tip down / stand up (`T`):** the six wheel legs unfold (`legs_extend`), then the hull pivots down about the lowest pad or wheel onto the wheels; `T` again stands it up (it asks the drill, panels and radiators to retract first) for a vertical launch (`O`, as the Heron).
- **Drive (`rover.js`):** six-wheel heavy rover, 11 m/s top speed, slow torquey acceleration (1.5 m/s^2, tapering), skid steering limited by the track width, body height and attitude from a least-squares plane through the six wheel contact points (`wheel_N` x, z), wheels spin on their nodes. Slopes pull on it, grip (Glaciera `gripAt`) limits acceleration, braking and lateral slip, lava and deep water are not driven into, boulders and spires block it. Battery drains with speed and the mast; with a flat battery it crawls at 15%. It rolls over beyond about 46 degrees of ground tilt (the drive eases off from about 20 degrees, and at crawling speed a stability control refuses to push into ground steeper than about 38 degrees, so a rollover takes speed or a sudden drop) (it stays on its back until `R` rights it: the roll reverses and, if the spot is too steep, it moves to the nearest gentle ground). Lava radiates heat into the hull (radiators matter).
- **Survey (the core loop):** the sensor mast (`sensor_raise`) rises by itself when driving (and stays up for 8 s), `Y` toggles it. The Ground Survey panel (top right) shows the local richness of the ground (0 to 100%, ice / regolith from `sampleAt`, a smooth field with a water-table or ice channel plus regolith variation) and an arrow towards the richest ground within 600 m, with the distance and the gain. `F` scans from the rover with a bigger radius (1.1 km, 150 m for species) than on foot (480 m, 60 m). Discoveries and species logging work as before.
- **Drill and refine:** `V` when parked and upright: the drill mast swings down through the belly bay (`drill_deploy`, the bit touches the ground at `drill_tip`), then takes 9 s; the yield is `sampleAt` amount x (1 + 3.5 x richness at that spot) (the toast reports it). `R` refines through the ISRU (6 s, draws power and makes heat) when parked. `P` panels and `K` radiators; they fold away by themselves when driving fast (over 4 m/s), in flight, on reentry and while tipping. Drilling and refining now also progress from the cab (they used to wait until the crew stepped out). The spaceplane can drill too.
- **Crew:** `E` exits at `crew_exit` (left flank) and enters again; the bike stays with the plane.
- **Debug hooks:** `__game.teleport('flight', x, z, { craft: 'lander', flat: true, world })` starts it in the rove pose; `__game.rover` has the actions.

### Atmospheric ascent test (unbroken run)
`explorer` was flown headless from the Verdant runway: `O` (takeoff and climb autopilot), jets to Mach 2.1, rocket, ascent hand-over to the orbit simulator and the orbit-scene ascent autopilot. This exposed two real problems that were fixed: the orbit-mode drag treated the plane as blunt (beta 640 kg/m2) even nose-first at Mach 3 (it now drops to a streamlined beta when the nose leads the velocity), and the tanks were too small for the real losses, so the Albatross now carries 4,300 kg CH4 and 13,500 kg LOX (was 2,100 / 7,560; the jet leg burns about 600 kg of methane). The rocket phase also climbs steeply (`ASCENT.zoomGamma` 0.8, orbit-scene `vzCap` 520 m/s) to leave the dense air early. `ascent.js` uses a flown jet leg of 750 m/s and multiplies the ideal atmospheric rocket dv by 1.85 (flown about 2,880 to 2,990 m/s vs 1,556 ideal).

**Final unbroken run** (headless, real time 646 s with 2x to 4x warp in the orbit scene): takeoff from the runway start (local -935, -165; the centre of the site would roll off the cliff), jets to Mach 2.1, rocket at 9.3 km, ascent hand-over, ascent autopilot, circularised at 171 km: Ap 261.5 km, Pe 127.5 km (e 0.012), no damage. Propellant 4,105 kg CH4 + 12,695 kg LOX used of 4,300 / 13,500 (94%); 195 kg CH4 + 805 kg LOX left.

### Flying the Albatross on an atmospheric world (`src/aeroflight.js`)
Entering the atmosphere from orbit keeps the plane in its flat attitude (reentry heating and drag as before), then the surface scene flies it as an aeroplane: lift and drag from `aero.js` with stall, jet thrust falling with density and rising with speed, rocket on `Mach 2.1+` or above 9.5 km, stability assist (A/D bank, W/S pitch; `Space` toggles direct control), wheel brakes (`Ctrl` on the ground, air brake in flight), gear that lowers near the ground, wheeled taxi, rotation, takeoff and landing on the terrain's real contact points (a rough touchdown is forgiven and recovered at 250 m).
`L` = runway landing assist (3.2 degree glide slope to the meadow strip, centreline tracking, flare, air brake, wheel braking), `O` = automatic takeoff and climb (ramp up, stow the bike first): jets build speed low and fast, a zoom climb, jet to rocket switch, then the existing ascent hand-over to orbit. `,` `.` apply 2x to 8x flight time during autopilot legs. Chase camera follows the flight path, widens its field of view with speed, and wingtip vapour appears at high angle of attack. The Heron lander flies the same powered descent with drag as before.

Checks done headless: takeoff to 12 km on jets and rocket and the hand-over into orbit view (jet climb, rocket switch at Mach 1.1 to 2.1 depending on the profile), runway landing from 6 km out with glide-slope tracking to a rolling stop, 57 fps on every scene after tuning.

## Character and on-foot loop

The astronaut is a skinned, authored female character (see Authored models). Animations: idle, walk (`walk_sexy`), run (Shift), low-g jump (hold Space for the jetpack) and a seated riding pose on the bike.
Exit and re-board loop (checked with real key presses in headless Chrome): plane or lander `E` out (the plane exit uses the `crew_exit` position beside the left hatch), walk or run, `E` near the plane to board again; from the plane: `T` tip, `Y` ramp, `B` rolls the bike out, `E` near the bike to ride, `E` at low speed to dismount,
then `B` next to the plane stows the bike (within 22 m), `Y` raises the ramp, and `T` stands the plane up for a vertical launch.

## Performance and checks

Measured in headless Chrome on an RTX 3090: about 57 fps (vsync) at 1280x720 on the surface and in orbit, 45 to 57 fps at 1600x900 with 4 CSM cascades, MSAA HDR + bloom. Terrain chunks are built in worker threads
(48 m chunks at 1 m grid up to 196 km, quadtree LOD, skirts), scatter is rebuilt into a handful of big `InstancedMesh`es, so there are no chunk hitches at bike speed.
Headless checks run during development (no test infrastructure was added): all 30 transfer plans fly to a circular capture orbit; Kestrel orbit -> descent assist -> surface handover -> auto-land; tail-first landing -> tip down -> ramp -> bike -> ride;
bike airtime: the two curated ramps near the landing site (about 250 to 450 m run-up toward Tamber, boost on) give 8 to 10 s of air in a headless physics run (best 9.9 s), gentle crests 3 to 6 s; sampling + refining refuels the plane; Albatross ascent to a circular orbit, carrier re-park and scripted docking; HUD overlap check at 1920x1080, 1366x768 and 1024x640; no console errors.

GLB integration shots (`11_*.png`): on-foot idle, walk_sexy mid-stride, run, low-g jump, bike rider mid-jump with Tamber, plane landed with gear, ramp, panels and bike, plane vertical on its tail legs (plus a burn shot), plane docked on the carrier.

Screenshots (`explorer/shots/`, `*_before.png` are the pre-polish versions at matching cameras): `01_orbit_0.png` / `01_orbit_1.png` (orbit view), `02_system_map_plan.png`, `03_system_map_transfer.png`, `04_descent_tail_first.png`,
`05_lander_astronaut_tamber.png` (lander + astronaut), `05b_astronaut_front.png`, `06_plane_tipped_ramp_bike.png` (landed plane + bike), `07_bike_airtime_tamber.png` (bike mid-jump with Tamber), `08_horizon_first_to_stand.png` (horizon: astronaut, spires, arch, Tamber),
`09_character_closeup.png` (+ `09b_character_run.png`, `09c_character_lowg_jump.png`), `10_reentry_glow_orbit.png` (Heron entering a temporary test atmosphere at about 4 km/s, orbit view, SKIN gauge on the HUD) and `10b_reentry_surface_scene.png` (glow in the surface scene).
Frame rate after the scene settles at 1600x900 in headless Chrome: 51 to 57 fps on foot, in the landed plane view, on the bike and in orbit; console clean (no errors or warnings).

## Known issues

- The orbit view of Kestrel is soft close up (the baked map is 2 km/texel; fine craters are procedural and do not match the surface scene).
- Chunk LOD borders are edge-stitched against the neighbour level (no more skirt comb on the ground); faint ribbing can still show on distant steep trench walls when seen from high above (shot `10b`).
- After an assisted ascent the orbit is slightly elliptical (e about 0.01 to 0.04, periapsis from 16 to 127 km), still inside the planner's limit; the scene hand-over happens below 14 km.
- Bike heading drifts on slopes with no steering input (no real roll dynamics: lean is a ghost-balanced angle); W also pitches the nose down in the air, so release it over big jumps.
- Hard-landing damage only costs propellant and resets to a hover; panel/radiator damage is a flag that lowers solar output.

## Files (`explorer/`)

| File | Purpose |
|---|---|
| `index.html`, `style.css` | shell, HUD, overlays |
| `src/main.js` | renderer, scenes, modes, transitions, HUD wiring, debug hooks |
| `src/destinations.js` | all six destinations + parents (orbits, SOI inputs, palettes, atmosphere, POI types); data only |
| `src/craft.js`, `src/vessel.js` | masses / Isp / thrust / tanks, rocket equation, engine modes, power + heat |
| `src/system.js`, `src/orbits.js`, `src/planner.js`, `src/transfer.js` | patched conics, Lambert, transfer planner, dv estimates |
| `src/world.js` | universal time, warp, orbit-mode physics, nodes, docking, autopilots, SOI transitions |
| `src/flight.js` | hover/tail-down surface flight, landing guidance, frame conversion |
| `src/terrain/kestrel.js`, `worker.js`, `terrain.js` | height recipe (CPU), quadtree chunk LOD in workers, terrain shader |
| `src/scatter.js` | instanced boulders, hoodoo spires, natural arches (seeded cells, colliders) |
| `src/sky.js`, `src/bodyview.js`, `src/frames.js` | star/giant/ring/moon sky shader, orbit-view body + atmosphere, coordinate frames |
| `src/atmo.js`, `src/water.js`, `src/flora.js`, `src/vegetation.js`, `src/ecology.js`, `src/aeroflight.js`, `src/terrain/verdant.js` | atmosphere, water, flora, fauna, winged flight, the Verdant recipe |
| `src/glbmodels.js`, `assets/models/*.glb` | GLB preload, astronaut mixer, bike and plane wrappers |
| `src/models.js`, `src/player.js`, `src/bike.js`, `src/fx.js` | procedural fallback models and carrier/lander, controllers, particles/plumes |
| `src/discovery.js`, `src/systemmap.js`, `src/hud.js`, `src/input.js`, `src/gfx.js`, `src/noise*.js`, `src/aero.js` | POIs + ISRU, map overlay, HUD, input, post-processing + CSM, noise, aerodynamics |

## Simplified / not in this milestone

- Only Kestrel has a surface. Other bodies render in orbit view (palette sphere, atmosphere rim) and say "surface survey pending". Atmospheric landings are not simulated.
- Rendezvous after an ascent is assisted: the carrier is re-parked 6 km ahead in the ascent orbit, and `C` runs a scripted docking approach (< 12 km).
- Kestrel's sun swings by an artificial few-minute "day"; Tamber stays fixed in the sky (tidally locked) and the sky does not follow the moon's true 50-day orbital geometry.
- Interplanetary transfers are patched conics with impulsive (time-compressed) burns; moon-phase windows are searched by the planner. No gravity-assist planner yet (hand-built node chains work).
- No audio.
