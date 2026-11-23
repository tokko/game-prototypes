# Visual Spec: Environment, Terrain, Vegetation, Buildings, Lighting, Sky, Atmosphere

Target look: `reference.png` panels 1, 2 and 4. Late-afternoon golden sun over Central European
countryside. Olive-to-gold fields, dark rich tree masses, blue aerial haze on distant hills,
desaturated, slightly cool shadows, warm highlights, stone and plaster village with terracotta and
slate roofs. Realistic and muted, never cartoon.

Out of scope (other specs): tank model, weapon/explosion/smoke/fire effects, HUD, soldiers.

All values are decisions. Tune them only by eye against the reference, and only within ±20%.

---

## 0. Conventions

- Units are metres. +Y is up, **north = -Z**, east = +X. Azimuth is measured clockwise from north.
- Terrain spans X,Z in [-1000, 1000]. The playable area is |X|,|Z| <= 700. 700-1000 is a framing rim.
- **All hex colors are sRGB albedo.** `THREE.Color` converts them to linear when ColorManagement is
  on (the default). Every canvas albedo texture gets `texture.colorSpace = THREE.SRGBColorSpace`.
  Normal, roughness and mask textures get `THREE.NoColorSpace`.
- Every canvas texture: `generateMipmaps = true`, `minFilter = LinearMipmapLinearFilter`,
  `anisotropy = min(8, renderer.capabilities.getMaxAnisotropy())`, `wrapS = wrapT = RepeatWrapping`
  unless stated otherwise.
- Every procedural generator uses one seeded PRNG (mulberry32, seed `1337`) and one seeded 2D/3D
  simplex or value-noise helper. The same seed must give the same world.
- **Layout coordinates.** If the layout/gameplay module already defines positions, its positions
  win. The numbers below are the default layout and a guide for proportions.

| Feature | Default position (x, z) | Ground height |
|---|---|---|
| Player start | (0, +620) | 2 m |
| Farm (red barn, farmhouse, sheds, orchard) | (-140, +360) | 4 m |
| Observation hill crest | (+30, +90) | 28 m |
| Village centre (square) | (0, -260) | 8 m |
| Church (on a knoll at the village's north-west) | (-70, -310) | 13 m |
| Enemy strongpoint (south-east village edge) | (+110, -170) | 7 m |
| Checkpoint (paved road, village south entry) | (+15, -150) | 7 m |
| Extraction area | (0, -640) | 3 m |

Dirt road: Catmull-Rom spline from (0,+700) through (-20,+450), (+10,+250), (+45,+100) (it passes
the hill's east shoulder), (+20,-60) and (0,-140). There it becomes the paved road, which runs
through the square to (0,-700).

---

## 1. Priority order (realism per unit of effort)

1. **Light pipeline:** sun, PMREM sky environment, ACES, shadows, and fog that matches the sky
   horizon exactly. Without this nothing else reads as AAA.
2. **Terrain shader:** splat fields, macro variation, anti-tiling, and baked sun visibility and AO.
3. **Trees:** leaf cards, spherical normals, inner darkening, per-instance color and scale jitter,
   and natural distribution (hedgerows, copses, solitary oaks).
4. **Grass, wheat and flower tufts** around the camera.
5. **Road ribbons:** dirt road with ruts and a grass median, and the paved village road.
6. **Buildings** with real window openings, roof sag and per-building tint. The church is the
   landmark.
7. **Props:** fences, stone walls, utility poles, hay bales and rocks.
8. **Military dressing:** strongpoint, checkpoint, wrecks, craters, damaged buildings and rubble.
9. **Polish:** cloud layer detail, wind, grading pass, foliage back-light.

Build in this order. Each step should look good before the next one starts.

---

## 2. Renderer, tone mapping, post

```js
renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5));
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 0.9;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap; // use PCFShadowMap if the installed version deprecates Soft
camera: PerspectiveCamera(fov 60 for third person / per tank spec, near 0.3, far 5000)
```

**Post (optional, priority 9).** Use one `EffectComposer` with an MSAA render target:
`new WebGLRenderTarget(w, h, { samples: 4, type: HalfFloatType })`. The chain is
`RenderPass -> OutputPass -> GradePass`. When the composer is active, tone mapping happens in
OutputPass. GradePass is a single ShaderPass that works on display-referred values:

- Saturation 0.90 (mix with luma, Rec.709 weights).
- Contrast 1.06 around 0.45.
- Split tone: shadows (luma < 0.35) are pushed toward `#3a4660` at 6%. Highlights (luma > 0.65) are
  pushed toward `#ffe2b8` at 5%.
- Vignette: `1.0 - 0.22 * smoothstep(0.45, 1.05, length(uv - 0.5) * 1.414)`.
- Do not use bloom, film grain, chromatic aberration or SSAO. They cost too much and look gamey.

If there is no post, keep exposure at 0.9 and rely on the palette.

---

## 3. Lighting

### 3.1 Sun

- Azimuth 245° (WSW), elevation 24°. The direction toward the sun is
  `sunDir = normalize(-0.828, 0.407, 0.386)`.
  - The player drives north with the sun at the left rear, so the faces in view are lit.
  - Long shadows fall toward the ENE, across the road.
  - From the observation hill, the village is side-lit from the left.
- `DirectionalLight` color `#ffd8a8` (about 4000 K), intensity **3.0**.
- Put `sunDir` into the shared `atmosphereUniforms.uSunDir` (section 5). The sky, fog, foliage
  back-light and env bake all read it.

### 3.2 Fill

- `scene.environment = pmrem.fromScene(skyOnlyScene, 0, 1, 5000).texture`. Bake it once at load
  from the sky dome of section 4, with clouds disabled and the sun disk turned down to 20%.
- Set `scene.environmentIntensity = 0.55` (r163+). On older versions, set `envMapIntensity = 0.55`
  on every material.
- `HemisphereLight(sky #a9bede, ground #6b5b40, 0.35)` adds the warm ground bounce that the env map
  lacks.
- Shadows must never go black. Shadowed grass should land around `#3c4232` on screen and shadowed
  plaster around `#6c6a6a` (cool, desaturated). If they are darker, raise the env intensity.

### 3.3 Shadow map (single camera-following frustum)

| Parameter | Value |
|---|---|
| mapSize | 4096 × 4096 |
| Ortho half-extent | 90 m (left/right/top/bottom = ±90), giving about 4.4 cm per texel |
| Center | Camera position + 35 m along the flattened camera forward |
| Light position | center + sunDir × 400; near 1, far 900 |
| Texel snapping | Each frame, transform the center into light space, round to texel size (180/4096), transform back. This stops shimmering. |
| bias / normalBias | -0.0003 / 0.04 |
| Casters | Buildings, trees, bushes, props, walls, fences, wrecks, camo nets, tanks |
| Not casters | Terrain, grass/wheat/flower tufts, road ribbons, decals, distant low-LOD trees |
| Receivers | Everything except the sky |

Beyond 90 m, the baked terrain sun visibility and baked tree shadows (section 6.4) take over. Do not
use Three's CSM. One frustum plus baking is cheaper and enough for a ground camera.

---

## 4. Sky

The sky is an inverted `SphereGeometry(4500, 32, 16)` with a custom `ShaderMaterial`:
`depthWrite false`, `fog false`, `side BackSide`, `renderOrder -1000`, and it follows the camera
position every frame.

### 4.1 Gradient (view direction `d`, `h = d.y`)

| Stop | Color |
|---|---|
| Zenith (h >= 0.6) | `#6a8cc4` |
| Mid (h = 0.18) | `#9cb2d8` |
| Horizon (h = 0) | **Must equal fog color F(d) from section 5**: `mix(#b4c2d8, #e8cfa6, sunFactor)` |
| Below horizon (h < 0) | Fog color F(d), blended to `#8e968f` at h = -0.2 (it is never seen past terrain) |

Interpolate with `pow` curves: `t1 = pow(clamp(h/0.18,0,1), 0.6)` and
`t2 = smoothstep(0.18, 0.6, h)`. Define `sunFactor = pow(max(dot(d, sunDir), 0), 6.0)`.

### 4.2 Sun

- Disk: `smoothstep(0.9994, 0.9997, dot(d, sunDir))`, color `#fff2d8 × 18`. It is HDR, so ACES rolls
  it off.
- Glow: `#ffd29a × (0.35 × pow(max(dot,0), 64) + 0.12 × pow(max(dot,0), 8))`.

### 4.3 Distant hill silhouettes (painted in the sky shader, no geometry)

This gives panel 1's blue layered hills behind the terrain rim.

- Azimuth angle `a = atan(d.x, -d.z)`.
- Layer 1 (far): ridge height `h1 = 0.018 + 0.012 × fbm1D(a × 3.0) + 0.006 × fbm1D(a × 11.0)` in the
  units of `d.y`. Color `mix(fogColor, #7f95b8, 0.45)`.
- Layer 2 (nearer): `h2 = 0.010 + 0.010 × fbm1D(a × 5.0 + 7.3)`. Color `mix(fogColor, #6d82a3, 0.6)`.
- A pixel is hill if `h < hN`. Add a 0.002 soft edge. Darken the bottom of each layer toward the
  horizon by 8% to suggest forested slopes.
- `fbm1D` is cheap: 3 octaves of `sin`-hash value noise.

### 4.4 Cloud layer (fair-weather cumulus, panel 1/4 coverage about 40%)

- Bake a tileable noise texture once: 512 × 512 canvas.
  - R = 6-octave tileable value-noise fBm (period 512).
  - G = inverted Worley F1 at 8 cells per tile (gives puffy cauliflower cells).
  - Store it as `NoColorSpace`, `LinearFilter`, repeat wrapping.
- Projection: for `d.y > 0.01`, intersect a plane at 1500 m: `p = d.xz / d.y × 1500`. Add a wind
  offset `uTime × vec2(3.0, 0.8)` m/s.
- Density:
  - `n = R(p/6000) × 0.6 + R(p/2100) × 0.3 + G(p/2600) × 0.35`
  - `cov = smoothstep(0.52, 0.78, n)`
  - Fade near the horizon by `smoothstep(0.01, 0.12, d.y)`, so the horizon stays hazy.
- Lighting:
  - A second sample offset toward the sun (`p + sunDir.xz × 120`) gives `n2`.
    `shade = clamp(1.0 - (n2 - n) × 3.0, 0, 1)`.
  - Cloud color = `mix(#8f98ad (base), #fff3e0 (lit top), shade)`.
  - Add a silver lining: `+ #ffe4bf × 0.6 × pow(max(dot(d,sunDir),0),8) × (1 - cov)`.
  - Final: `skyCol = mix(skyCol, cloudCol, cov × 0.92)`.
- Also add 15% `#c9d3e6` wispy cirrus with
  `smoothstep(0.55, 0.75, R(p/9000 + 0.37)) × 0.15`.
- Clouds do not cast shadows. Optional: multiply the sun intensity on the terrain by
  `1 - 0.25 × cov` sampled at the fragment's world xz. Priority 9, skip if busy.

---

## 5. Atmosphere and fog (one shared function)

The fog color and the sky horizon must be computed by the same GLSL function. This one rule removes
the "game horizon line".

Keep one shared `atmosphereUniforms` object and pass it to every material by reference:
`uSunDir`, `uSunViewDir` (sunDir transformed by viewMatrix, updated per frame), `uCamPos`, `uTime`,
`uViewToWorld` (mat3, the camera rotation), `uFogDensity = 0.00042`, `uFogHeightFalloff = 0.011`,
`uFogMax = 0.9`.

A `patchMaterial(mat)` helper uses `onBeforeCompile` to merge these uniforms. It replaces
`#include <fog_pars_vertex>` and `<fog_vertex>` so they output `varying vec3 vFogView = mvPosition.xyz;`.
It replaces `#include <fog_pars_fragment>` and `<fog_fragment>` with:

```glsl
vec3 atmoFogColor(vec3 dirWorld) {            // shared with sky
  float s = pow(max(dot(dirWorld, uSunDir), 0.0), 6.0);
  return mix(vec3(0.456,0.539,0.687), vec3(0.807,0.624,0.381), s); // linear of #b4c2d8 / #e8cfa6
}
// fog_fragment:
vec3 rayW = uViewToWorld * vFogView;
float dist = length(rayW);
vec3 dirW = rayW / dist;
float hAvg = uCamPos.y + rayW.y * 0.5;                      // mean height along ray
float dens = uFogDensity * exp(-max(hAvg, 0.0) * uFogHeightFalloff);
float f = min(1.0 - exp(-dist * dens), uFogMax);
gl_FragColor.rgb = mix(gl_FragColor.rgb, atmoFogColor(dirW), f);
```

Resulting haze: about 10% at 250 m, 34% at 1 km, and about 50% at the 2 km rim (the sky-painted hill bands carry the strongest blue). Far ridges come
out blue (panel 1 far hills measure `#6280a7` on screen).

Set `scene.fog = new THREE.FogExp2(0xb4c2d8, 0.00042)` only so Three enables the fog defines. The
patched chunk ignores its color. Every environment material (terrain, foliage, grass, buildings,
props, roads) must go through `patchMaterial`. Tell the tank and effects owners to call it too.

---

## 6. Terrain

### 6.1 Geometry and heightfield

- Height grid: 513 × 513 over 2000 m (3.906 m spacing), stored as `Float32Array`.
- Render mesh: `PlaneGeometry(2000, 2000, 512, 512)` rotated to XZ, with heights applied. That is
  about 525k triangles in 1 draw call.
- Normals come from central differences on the height grid, not from `computeVertexNormals` on
  faceted data. This keeps them smooth.
- Upload heights as a `DataTexture` (513², `RedFormat`, `FloatType`, `LinearFilter`, clamp) named
  `uHeightTex`. Grass and road vertex shaders sample it.
- Expose `getHeight(x, z)` as a bilinear CPU sampler for prop placement.

Height composition, in order:

1. Base: `6 × fbm(x/420, z/420, 4 oct)` plus `2 × fbm(x/90, z/90, 3 oct)`. Gentle rolling ground.
2. Observation hill: Gaussian of amplitude 24, sigma 110 m at (+30, +90). Multiply it by
   `1 + 0.15 × fbm` so it is not a perfect dome. The north slope (toward the village) is steeper:
   use sigma 80 for z < 90.
3. Village basin: drop toward 6-9 m around (0, -260) with radius 220. Add a church knoll: Gaussian
   +5, sigma 35 at (-70, -310).
4. Rim: for `r = max(|x|,|z|) > 720`, add `smoothstep(720, 980, r) × (35 + 45 × fbm(x/300, z/300))`.
   Forested ridges close the horizon.
5. Road flattening: within the road half-width + 3 m, set height to the spline's smoothed
   centreline height. Blend over a further 4 m using smoothstep. Cross-camber is 0.
6. Building, field and military pads: flatten each footprint + 2 m to its mean height, blending over
   4 m.
7. Craters (6-10 total, mostly near the strongpoint and village edge): a depression of -1.6 m at
   radius 0-3 m and a +0.5 m rim at 4 m, falling off to 0 at 6 m.
8. Trench ditch: zigzag polyline of 3-4 segments, 12-18 m each. Depth -1.4 m, flat bottom 3 m wide,
   berms of +0.6 m on both sides. See 9.6.

### 6.2 Splat maps (2 × 2048² canvases, about 1 m per texel)

Draw them with canvas 2D paths, blurred with `ctx.filter = 'blur(2px)'` per stroke. The noise jitter
on edges is described below.

| Map.ch | Meaning | How it is drawn |
|---|---|---|
| A.R | Road shoulder / bare dirt | Road spline stroked at road width + 3 m with 4 px blur. Farmyard and strongpoint yard polygons. |
| A.G | Wheat / gold field | Field polygons of type wheat or stubble |
| A.B | Plowed soil | Field polygons of type plowed |
| A.A | Flower meadow | Fallow field polygons; random 10-30 m blobs at 40% inside pastures |
| B.R | Scorch / burn | Radius 5-9 m soft disks at craters, wrecks and burning buildings |
| B.G | Trampled / gravel village ground | Village square, house yards, trench berms, checkpoint |
| B.B | Forest floor | Disk of radius crown × 1.3 under every tree, drawn at alpha 0.5 |
| B.A | Tree shadow bake | Section 6.4 |

Fields are quads with sides of 70-200 m, rotated ±15° off the road axis and separated by 3-5 m grass
margins. Before filling, perturb each field edge with noise (±2 m) by subdividing the edges every
5 m.

Field type mix:

| Type | Share |
|---|---|
| Wheat (gold) | 35% |
| Pasture (base grass) | 30% |
| Fallow flowering | 15% |
| Plowed | 10% |
| Stubble with hay bales (gold channel at 60% plus a stubble flag; use wheat with no tufts) | 10% |

Keep a CPU list of field polygons and types. Grass and wheat placement and hay bales read it.

### 6.3 Layer textures (512² canvases unless noted)

| Layer | Tile size | Recipe |
|---|---|---|
| Grass (luminance only) | 3 m | Gray base 0.55. 3 fBm octaves (±0.12). 4000 short strokes 1-3 px wide, 6-14 px long, random angle within ±25° of vertical, value 0.35-0.85. Speckle 3000 dots. Alpha = height (stroke density). |
| Wheat | 3 m | Base `#b8975a`. Vertical-ish strokes in `#c9a865`, `#a8864c`, `#d8bd80`. Fine noise ±6%. Rare 1% `#7a6a3a` dark gaps. |
| Plowed | 4 m | Base `#5b4633`. Furrows are horizontal sine stripes with a 0.35 m period: ridges `#6e5640`, troughs `#3e3024`. Clod noise of 2-5 px dots. Alpha = stripe height. |
| Dirt | 3 m | Base `#8c7658`. 2-octave blotches between `#a08868` and `#6f5c44`. 1500 pebbles (2-4 px ellipses, `#9d917f`/`#5d5244`, each with a highlight pixel above). Alpha = pebble height. |
| Rock | 6 m | Base `#7a756c`. Worley-cell plates in `#8d877b`/`#696459` with dark cracks `#4b4740` along cell borders. Lichen dots `#8c8a5a` at 4%. |
| Forest floor | 3 m | Base `#3e3a28`. Leaf litter: ellipses `#5a4a30`, `#6b5a36`, `#4a4a2a`. Twig lines. |
| Scorch | 4 m | Base `#2a2622`. Ash patches `#5a5650`. Blend with underlying soil at 70%. |
| Detail normal (shared) | 2 m | Height = 4-octave fBm + grass strokes. Sobel to normal with strength 2.0. |
| Macro (1024²) | 256 m | R = fBm brightness (±1). G = low-frequency dry/lush selector. B = 30-60 m patch noise. Tileable. |

### 6.4 Baked lighting (vertex attribute `aBake`, vec3)

Bake once at load. The budget is under 400 ms; run it in a worker if it goes over.

- **R: sun visibility.** From each grid vertex, march along sunDir (projected) for 48 steps with
  step `4 m × 1.08^i` (reaching about 1.5 km). Track the max of `(H(p) - rayHeight)` and map it with
  `vis = 1 - smoothstep(0, 3, maxExcess)`. Hills cast soft long shadows.
- **G: ambient occlusion.** In 8 directions, take 6 samples each out to 60 m. Compute
  `ao = 1 - 0.6 × avg(max(horizonSlope, 0))`, clamped to [0.55, 1].
- **B: tree shadow.** For each tree, darken grid vertices within radius `crown × 1.1` around
  `treePos + shadowDir × treeHeight × 0.5 / tan(24°)`, where shadowDir = -sunDir.xz normalized. Use
  `B = min(B, 0.45 + 0.55 × d/r)`.
- In the shader:
  - `directDiffuse *= R × mix(1.0, B, smoothstep(70.0, 95.0, distToCam))`. Baked tree shadows only
    appear where real shadows end.
  - `indirectDiffuse *= G`.
  - Inject this in `lights_fragment_end`.

### 6.5 Terrain material

Use `MeshStandardMaterial` (roughness 1, metalness 0) with `onBeforeCompile`. Replace `map_fragment`
and `normal_fragment_maps` and pass world position through a varying.

1. **UVs.** `uvN = worldXZ / tile` per layer. Anti-tiling: sample every layer twice, at `uvN` and at
   `uvN × 0.29 + 0.37`, and mix 60/40. Also blend toward the far-scale sample with
   `smoothstep(40, 160, dist)`.
2. **Base grass color.**
   - `grassCol = lum × mix(lush, dry, macro.G)`, then add patches with macro.B toward a third tone.
   - lush `#5a6a30`, dry `#8a8046`, sunburnt patch `#9c8a52`.
   - Low wet ground (height < 3 m and AO > 0.85) shifts 20% toward `#4b5e2a`.
   - Hilltops (height > 20 m) shift 25% toward dry.
3. **Slope.** `slope = 1 - N.y`.
   - Exposed dirt weight: `smoothstep(0.06, 0.16, slope) × 0.6`.
   - Rock weight: `smoothstep(0.16, 0.30, slope)`.
4. **Height-aware blending.**
   - Weights: grass base 1, then `splat_i × 1.0` for each layer and the slope weights.
   - Per layer: `w_i' = max(w_i + h_i - (maxOf(w + h) - 0.25), 0)`, then normalize. `h_i` is the
     layer texture alpha. Edges between grass and dirt become crisp and broken, not mushy.
5. **Macro brightness.** Multiply final albedo by `1 + 0.10 × macro.R`. Add a tiny hue shift of ±4%.
6. **Normal.** Geometric normal plus the detail normal (tile 2 m). Strength 0.5 on grass, 0.8 on
   dirt and plowed, 1.0 on rock. Fade to 0 by 80 m.
7. **Roughness.** 1.0 everywhere. Puddles are optional and out of scope.

Target on-screen colors (sunlit, after tone mapping): meadow `#8e8a52` to `#a99a5c`, wheat `#c8a564`,
plowed `#6e5640`, dirt road `#a68c72`. These match the panel 1 samples. If the result is greener,
lower the green in the lush tone. Do not push the yellow up.

---

## 7. Roads (ribbon meshes)

- Build each road as a strip along its spline: one cross-section every 2 m, conformed to `getHeight`
  plus 0.04 m.
- Material: `polygonOffset` on (factor -2, units -4), `renderOrder 1`, `receiveShadow`, patched fog.
- Attributes: `u` in [0, 1] across the width, `v` = metres along the road.

**Dirt road** (width 5.0 m, cross-section of 9 vertices):

- Color zones by `u`: shoulder (0-0.08) blends into terrain via alpha, then rut, median, rut,
  shoulder.
- Ruts centred at u = 0.30 and 0.70, each 0.16 wide.
  - Rut color `#7a654b`. Compacted surface `#9a8264`. Loose dust `#ad9676` at the edges.
  - Median (0.42-0.58) holds sparse grass `#6f7040`, opacity 60%, broken by noise.
- Albedo is the dirt layer texture tinted by those zones. Add noise
  `fbm(v/7, u×4)` for patchy coloring.
- Puddle blobs: noise threshold over 0.82 inside the ruts. Color `#5a4d3e`, roughness 0.25.
- Edge alpha = `smoothstep(0, 0.08, u) × smoothstep(1, 0.92, u)`, multiplied by a noise jitter
  (±0.04 on u). Use `transparent: true, depthWrite: false` and alpha blend. The terrain splat A.R
  already makes a dirt shoulder underneath, so the blend is seamless.
- Grass tufts and wheat are suppressed where splat A.R > 0.5, except a sparse median strip.

**Paved road** (width 7.0 m, village and extraction):

- Asphalt texture (512² = 4 m):
  - Base `#48484a`. Aggregate speckle (8000 dots, `#5d5c5a`/`#353537`).
  - 6 crack polylines: random walks of 40 steps, 1 px, `#2a2a2c`.
  - 3 patch rectangles in `#3d3d40` with lighter borders.
  - Worn wheel paths at u = 0.28 and 0.72 lightened 6%. Faint dust `#6b655c` at 20% at the edges.
  - No center line (rural, old).
  - Roughness 0.85; wheel paths 0.75.
- Curbs: inside the village only. 0.25 × 0.15 m extruded profile along both edges, concrete
  `#8f8c85`.
- Sidewalk strip 1.5 m outside the curb, flat, cobble texture: 256² = 1 m, stones 10-14 cm, colors
  from the stone palette darkened 15%, dark joints `#3f3a33`.
- Edges outside the village use the same alpha fade as the dirt road, over 0.05 of the width.
- Rubble and debris instances (9.7) are scattered on the paved road near damaged houses.

---

## 8. Vegetation

### 8.1 Shared foliage atlas (1024² canvas, sRGB, alpha) and material

| Quadrant (UV) | Content |
|---|---|
| [0, .5]×[0, .5] | Bark: vertical stretched noise. Base `#4a4136`, fissures `#2e2822`, ridges `#5f5546`, lichen `#7d7b58` at 5% |
| [.5, 1]×[0, .5] | Broadleaf cluster card: 90-140 leaf ellipses (each 14-26 px long, random rotation), drawn from the card center outward, alpha 1, on transparent. Per-leaf color from the leaf palette ±8% value. Each leaf has a lighter top half (painted highlight). |
| [0, .5]×[.5, 1] | Conifer needle card: a drooping branch spray. A central twig with 60 needle strokes (1-2 px, 10-18 px long) on each side, angled 40°, in the conifer palette. |
| [.5, 1]×[.5, 1] | Grass/flower card set: 4 vertical strips. Grass blades (tapered polygons, 30 per strip). Wheat stalks with ears. Flower tufts with dots `#f2efe6` (white), `#c9a0c8` (pink-mauve, reference meadow), `#e6c84a` (yellow). Dry grass. |

**Leaf palette:**

| Group | Colors |
|---|---|
| Broadleaf | `#4a5a2a`, `#56662f`, `#3d4d24`, `#606a32` |
| Sunlit tips (applied by shader, not texture) | `#8f8c46` |
| Conifer | `#2f3d26`, `#34432a`, `#26331f`, `#3b4630` |
| Poplar | `#55652e`, `#677238` |
| Orchard | `#5e6e34` |

**Tree material:** `MeshStandardMaterial({ map: atlas, alphaTest: 0.5, alphaToCoverage: true,
side: DoubleSide, roughness: 0.85, metalness: 0 })`, patched with:

1. **Wind.** Wind direction is +X (from the west). `hN = clamp(position.y / treeHeight, 0, 1)`.
   Trunk bend: `offset.xz += windDir × (sin(uTime×1.1 + phase) × 0.6 + 0.4) × amp × hN²`.
   Leaf flutter: `+ 0.035 × sin(uTime×5.3 + dot(worldPos, vec3(1.7, 2.3, 1.1)))` on crown vertices
   only (`aCrown = 1`). `phase` = instance world `(x×0.13 + z×0.17)`. `amp` is 0.15 broadleaf,
   0.08 conifer, 0.20 poplar, 0.10 bushes.
2. **Spherical normals.** Crown vertices store normal = `normalize(vertex - crownCenter)`, blended
   80% with the card normal. Foliage then shades like a soft volume, not like cards. This is the
   single biggest anti-faceting trick.
3. **Inner darkening.** Bake vertex color: `0.45 + 0.55 × smoothstep(0, 1, distFromCenter/crownRadius)`.
   Multiply in. Add 15% extra darkening on the bottom (`y < centerY`).
4. **Per-instance tint.** `setColorAt`, value jitter ±12%, hue jitter ±4% (some warmer/yellower).
   About 10% of broadleaf trees get a dry tint `#8a7e44` at 25% mix.
5. **Back-light translucency.** In `lights_fragment_end`:
   `reflectedLight.directDiffuse += sunColor × diffuseColor × 0.35 × pow(max(dot(-viewDir, sunDir), 0), 4) × aCrown`.
6. **Sun tips.** `diffuse = mix(diffuse, #8f8c46, 0.25 × max(dot(sphericalN, sunDir), 0) × aCrown)`.
7. **Shadows.** `customDepthMaterial = MeshDepthMaterial({ depthPacking: RGBADepthPacking, map: atlas, alphaTest: 0.5 })`,
   patched with the same wind code so shadows sway.

### 8.2 Species recipes

All trunks are tapered `CylinderGeometry` (8 radial segments, 4 height segments) with each ring
jittered ±4 cm. UVs map to the bark quadrant. Merge each species into one `BufferGeometry` (trunk +
crown) with attributes `aCrown` and baked color.

| Species | Height | Trunk | Crown construction | Tris (approx) |
|---|---|---|---|---|
| **Oak/linden** (solitary, hedgerow) | 9-16 m | r 0.45→0.22, bare to 35-45% height, plus 3 branch cylinders (r 0.12, 2.5 m, angled 35-55° up) | 7-9 lumps (ellipsoid centres within an ellipsoid of radius 0.45H horizontal × 0.35H vertical). Per lump: inner core = `IcosahedronGeometry(r, 1)` displaced by noise ±15%, color darkened 40% (fills holes); plus 10 cluster cards (1.6-2.4 m quads) on the lump surface facing outward ±30°, random roll. Silhouette: broad, irregular, wider than tall. | ~420 |
| **Spruce/fir** (copses, hill, village) | 12-22 m | r 0.35→0.05, full height | 8-10 stacked open cones from 15% height to the top. Radius = `0.28H × (1 - t)^0.9 + 0.3`. Each cone: 10 radial segments, rim vertices drooped down 0.4-0.8 m and jittered ±0.3 m. Needle-card UVs radial. Plus 12 small needle cards in a spray at the top. Silhouette: narrow, ragged, dark (reference panel 1/4). | ~360 |
| **Lombardy poplar** (rows along the paved road, farm windbreak) | 18-24 m | r 0.3→0.1 | 6 lumps stacked in a narrow column (horizontal radius 0.11H), 8 cards each | ~330 |
| **Fruit tree** (farm orchard, gardens) | 4-6 m | r 0.15, bare to 1.4 m, crooked (2 segments offset 0.2 m) | 4 lumps in a rounded crown of radius 2-2.5 m, 7 cards each, palette `#5e6e34` | ~200 |
| **Bush/hedge** | 1.2-3 m | none | 3-5 lumps flattened 0.7 in y, 6 cards each. Hedgerows are rows of overlapping bushes every 1.6 m. | ~150 |
| **Low-LOD tree** (rim forest > 720 m) | as species | trunk 5 segments | 3 icosahedron blobs (detail 0), no cards, vertex-noise displaced, same palette and spherical normals, `alphaTest` off | ~70 |

### 8.3 Distribution rules (Poisson disk based, seeded)

| Rule | Value |
|---|---|
| Exclusions | Road half-width + 6 m; field interiors (except solitary oaks in pastures); building footprints + 4 m; slope > 32°; trench/bunker footprints + 5 m |
| Hedgerows | 60% of field margins: bush every 1.6 m with ±0.5 m jitter, plus an oak/linden every 10-18 m (60% oak, 25% spruce, 15% fruit). Gaps of 6-20 m at 30% of margins (gates, tank crossings). |
| Copses | 8-12 copses in the playable area, 25-70 m radius, min spacing 7 m. 65% broadleaf, 35% conifer; conifer share rises to 60% for ground > 15 m. Bush understory at the copse edge, 1 per 25 m². |
| Solitary trees | 1 per 2 ha of pasture/meadow, oak only, scale 1.1-1.3 |
| Observation hill | Sparse: 1 tree per 600 m² on its flanks, the crest kept open for the view |
| Farm | Orchard: 6 m grid, ±1.2 m jitter, 30-40 fruit trees. Poplar windbreak row of 10 north of the barn. |
| Village | 1 fruit tree or linden per house garden; 2 large lindens at the square; spruce clump behind the church |
| Rim forest (720-1000 m) | Low-LOD trees, 1 per 70 m², min spacing 6 m. About 6000 instances, 70% broadleaf blobs, 30% conifer cones |
| Scale and rotation | Uniform scale 0.8-1.25. Random Y rotation. Tilt ±3°. Sunk 0.3 m. |

### 8.4 Grass, wheat and flowers near the camera (GPU-placed ring)

- **Geometry.** One tuft is 3 crossed quads (60° apart). Each quad is 0.6 m wide and 0.45-0.7 m
  tall, 2 height segments for the bend: 12 triangles.
- **Instances.** An `InstancedMesh` with a fixed jittered lattice of local offsets over 128 × 128 m
  (spacing 0.75 m plus jitter, about 29k instances).
  - The vertex shader adds `camXZ` snapped to 0.75 m, so the lattice slides without popping.
  - It samples `uHeightTex` for Y, and the splat maps and macro map for type and density.
  - Hash-based keep probability:
    - Pasture 0.85.
    - Meadow: 1.0, with 18% of tufts using flower strips.
    - Wheat field: switch to the wheat strip; tuft height 0.9-1.1 m, spacing doubled visually by
      scaling width 1.3, keep 1.0.
    - Plowed 0.05. Road 0.0 (median 0.3). Village gravel 0.25. Forest floor 0.2.
    - Scorch 0.0. Rock slope 0.1.
  - Discarded instances collapse to a zero-area position.
- **Color.** Base color equals the terrain grass color at that point (same macro and lush/dry
  formula, computed in the vertex shader). Tips lighten 25% toward `#b5a868`. Bottoms darken to 55%
  so the tuft sits in the ground.
- **Normals.** Use `mix(cardNormal, vec3(0,1,0), 0.75)`. Grass then lights like the terrain, with no
  black/white card flicker.
- **Fade.** Scale to 0 over 50-62 m from the camera, combined with alpha-to-coverage.
- **Wind.** Tip displacement `0.08 × sin(uTime×2.1 + worldX×0.35 + worldZ×0.2)` plus a gust term
  `0.05 × fbmTex`. Wheat sways 1.5× more and in phase across the field, giving visible waves.
- **Material.** No shadow casting; receives shadows. Same atlas, alphaTest 0.5, alphaToCoverage,
  DoubleSide.
- **Mid-distance gold.** Beyond 60 m, wheat fields read from the terrain wheat layer. Add a shader
  "sheen": `+ 6% brightness × pow(max(dot(reflect(-viewDir, up), sunDir),0),4)` for the backlit
  golden glow in panel 1.

---

## 9. Buildings and props

### 9.1 Material palettes

| Material | Colors | Roughness |
|---|---|---|
| Stone masonry | `#9a8e7a`, `#857a68`, `#a89c86`, `#6f665a`, `#b3a690`, mortar `#8c8474` | 0.9 |
| Plaster | cream `#d8cdb5`, ochre `#cdb99a`, grey-white `#c9c3b4`, sand `#b9a184`, pale yellow `#d6c4a0`, faded pink `#c9ab9a` | 0.92 |
| Terracotta tile | `#9a4a32`, `#a8573a`, `#874030`, `#b06844`, aged `#7c4a3a` | 0.8 |
| Slate | `#4f535c`, `#5b5f68`, `#444852`, `#626570` | 0.6 |
| Timber (weathered) | `#6b5a46`, `#5a4a39`, dark `#3e3328`, fresh `#8a7154`, grey-silver `#7d776c` | 0.85 |
| Barn red siding | `#7e2f25`, `#8c3a2b`, worn `#6e3a30` | 0.85 |
| Trim and frames | white `#d9d4c8`, green shutters `#4b5a45`, brown `#5a4535` | 0.7 |
| Glass | `#1d2226` | 0.12, metalness 0, env reflection |
| Interior darkness | `#15130f`, unlit-looking | 1.0 |
| Concrete | `#8f8c85`, bunker `#7c7a72` | 0.95 |
| Burnt and rust | `#2b2724`, `#3a332d`, rust `#6e3f26`, `#8a5232` | 0.95 |

### 9.2 Building textures (canvas recipes; each also yields a height canvas, Sobel to normal at strength 2.5)

- **Rubble stone wall** (1024² = 2 × 2 m, panel 4 look):
  - Fill with mortar. Pack rows 10-18 cm tall (51-92 px), with 30% of stones spanning 2 rows.
  - Each stone: width 15-45 cm, a rounded irregular polygon of 6-9 jittered vertices inset 4-7 px
    from its cell.
  - Color from the stone palette ±6%, plus 2-octave inner speckle.
  - Fake bevel: a 3 px lighter stroke on the top edge and a 3 px darker stroke (`#4e463c`) on the
    bottom edge.
  - Height: stones 200-255, mortar 40.
- **Plaster** (512 × 1024 = 2 m wide × 8 m tall, clamped vertically, v = height/8):
  - Base color, then low-frequency blotches ±5%.
  - Rain streaks: 40 vertical strokes from the top, 1-4 px wide, alpha 0.06-0.12, darker
    `#6b6458`, fading downward.
  - Bottom 0-0.5 m: a damp/dirt band blending to `#7d735f` with noisy edge. Optional green tint
    `#6a6a4a` at 20%.
  - 6 chipped patches (8-30 cm) revealing the stone texture with a darker rim.
  - Height: flat; patches are recessed.
- **Terracotta roof** (512² = 2 × 2 m):
  - Rows 0.30 m (77 px), tiles 0.22 m (56 px), offset by half a tile on alternate rows.
  - Each tile: vertical gradient from 85% to 110% of its base color, a dark overlap shadow line
    (`#3a2018`, 6 px) along the bottom, and a 2 px dark gap at the sides.
  - Per-tile color picked from the palette ±5%. 5% moss/lichen speckle `#6d6a3e`/`#8a8660`.
    Soot fade toward the ridge row at 5%.
- **Slate roof:** rows 0.18 m, staggered, rectangular slates with 1-2 px dark gaps, palette ±6%.
  12% slates slightly rotated ±2°. Lichen `#8a8a72` at 3%.
- **Planks** (512² = 2 × 2 m): planks 0.18-0.24 m wide (vertical for the barn and sheds, horizontal
  for fences and revetment).
  - Grain: 30 stretched noise lines per plank at ±4% value.
  - 1-3 knots (dark ellipses with rings). Gaps 3 px `#1c1814`.
  - Per-plank value ±8%. The barn version is tinted barn red with 15% worn patches showing grey
    timber.
- **Concrete:** base `#8f8c85`, horizontal formwork lines every 0.25 m (`#7a776f`, 1 px), stain
  streaks, 2-octave blotches.

### 9.3 Construction method (all buildings)

- **Walls.** Each façade is a `THREE.Shape` rectangle (or a pentagon for gables) with **window and
  door holes**, extruded 0.45 m with `ExtrudeGeometry` (`bevelEnabled: false`). Windows therefore
  have real reveals that catch sun and shadow.
- **UVs.** Recompute as world-metric: `u` = along the wall, `v` = height above the base, divided by
  the texture's metres.
- **Interior.** Place a dark inverted box inside each house (inset 0.5 m), so openings read as dark
  rooms with no visible back faces.
- **Window unit** (instanced across all buildings):
  - Glass quad recessed 0.15 m from the outer face.
  - Frame of 4 thin boxes, 0.07 m, plus a cross mullion.
  - Stone sill: 0.12 m proud, 0.08 m tall, 0.1 m wider each side.
  - Optional shutters on 50% of plaster houses: 2 plank-texture boxes each half the window width,
    hinged open at 100-170°, colored green or brown from the trim palette.
- **Roof.**
  - Two slabs of 0.12 m thickness, each a `PlaneGeometry` subdivided 8 × 6. Interior vertices get
    a ±3 cm sag/noise offset and the ridge sags 4-8 cm at mid-span.
  - Eaves overhang 0.45 m, gable overhang 0.3 m. Fascia boards are timber boxes.
  - Ridge cap: a half-cylinder (r 0.12 m) in roof color darkened 15%.
- **Chimney.** 0.6 × 0.6 m, stone or plaster, rising 1.0-1.4 m above the roof surface, with a cap
  slab.
- **Base AO.** Bake vertex color darkening on walls: `0.65` at ground level, ramping to `1.0` by
  0.8 m height. Also darken 15% under eaves (the top 0.4 m of walls).
- **Per-building tint.** Vertex color ±6% value, ±3% hue (bake it before merging).
- **Merge.** Merge all static buildings per material with `BufferGeometryUtils.mergeGeometries`:
  stone, plaster, terracotta, slate, timber, barn siding, trim, glass (instanced), interior,
  concrete. The village costs about 10 draw calls.
- **Base.** Sink every building 0.3 m into its flattened pad. Paint splat B.G (gravel/trampled) in a
  1.5 m ring around it.

### 9.4 Building recipes

| Type | Count | Footprint | Wall height | Roof | Openings |
|---|---|---|---|---|---|
| A. Stone house, 2 floors (panel 4) | 6-8 | 9 × 7 m (±1 m) | 6.0 m | Slate 42° (60%) or terracotta 40°; 30% have 1-2 dormers (1.6 × 1.4 m boxes with mini gable roof) | Windows 1.0 × 1.4 m, sills at 0.9 m and 3.9 m, horizontal pitch 2.2 m, min 0.8 m from corners. Door 1.1 × 2.2 m centred on the long street façade with a stone surround 0.15 m proud. |
| B. Plaster house, 1.5 floors | 6-9 | 10 × 7 m | 4.2 m | Terracotta 45° | Windows 1.0 × 1.3 m, one row, plus 1-2 small gable windows 0.6 × 0.8 m. Stone corner quoins on 40% (alternating 0.3/0.5 m blocks, 2 cm proud). |
| C. Townhouse row (along the paved road, square) | 2 rows of 3 | 7 × 10 m each, shared walls | 9.0 m (3 floors) | Terracotta 38°, eaves to street | 3 windows per floor; ground floor of the end unit is a shopfront 3.0 × 2.4 m opening. Dark brick-red plaster `#8d5a48` variant allowed (panel 3). |
| D. Red barn (panel 1) | 1 | 18 × 10 m | 5.0 m | Grey corrugated/slate-look 35°, 0.6 m overhang | Barn doors 4 × 4 m on the gable (plank X-bracing in white trim); 4 small windows 0.8 × 0.8 m with white frames; white corner trim boards 0.15 m |
| E. Farmhouse | 1 | 12 × 8 m | 5.5 m | Terracotta 42° | As type B, plus a timber porch 3 × 2 m |
| F. Sheds / outbuildings | 4-6 | 6-8 × 4-5 m | 3.0 m | Single pitch 15° (corrugated grey `#7b7d7f`) or gable 30° | 1 door, 0-1 window; weathered timber planks |
| G. Church (landmark, visible from start) | 1 | Nave 22 × 11 m | 9.0 m | Slate 50° | See below |

**Church (G):**

- Nave walls in plaster cream `#d8cdb5` with stone quoins.
- 4 tall arched windows per side, 1.4 × 4.0 m. Build the arch as a shape hole with a semicircular
  top (12 segments). Glass is dark.
- Apse at the east end: half-cylinder r 4.5 m, 7.5 m tall, with a half-cone roof.
- Tower at the west end: 6 × 6 m, 22 m tall.
  - Belfry openings: 2 per side at the 17-20 m band.
  - Clock face: a 1.4 m disc in `#d9d4c8` with a dark ring and hands, on 3 sides at 15 m.
- Spire: an octagonal pyramid (`ConeGeometry(4.2, 14, 8)`) in slate `#4f535c`, with a small cross
  at the top. Total height about 36 m.
- A low stone churchyard wall (1.1 m) surrounds it. Place 12 gravestones (thin 0.5 × 0.8 × 0.12 m
  boxes, stone, tilted ±6°) in the churchyard.

**Damage variants** (assign 4-6 village buildings near the strongpoint and square; static):

1. **Roof breach.** Remove a 3 × 4 m area of roof slab (build the slab as two pieces around a
   noise-edged hole). Expose 6 rafters (0.12 × 0.18 m timber boxes, 2 broken short at random
   lengths). Rubble pile at the base.
2. **Collapsed corner.** Replace one corner's façade shapes with jagged-top outlines: the top edge
   becomes a noisy polyline, losing 2-5 m of height at the corner, with a roughly 40° stepped
   break. Half the roof on that side is missing. A large rubble mound (9.7) spills outward 4-6 m.
3. **Burnt shell.** No roof. Walls are kept with jagged tops (lose 0.5-1.5 m). Interior box
   removed and replaced with charred floor beams.
   - Soot streaks above every window opening: a vertical gradient decal 1.2 × 2.5 m in `#1e1b18`
     at alpha 0.7, fading upward, noisy edges. Use a `DecalGeometry` or offset quads with
     polygonOffset.
   - Scorch splat on the ground.
4. **Shell holes.** 2-4 façade holes: circular shape holes of r 0.5-1.2 m with jittered edges, plus
   dark chip decals (r × 1.6, `#3e3830`) around them.
5. **Glass.** Damaged buildings have 70% of their windows with the glass instance removed (dark
   hole only) and 30% with shutters hanging at an angle.

### 9.5 Rural props

| Prop | Geometry | Notes |
|---|---|---|
| **Post-and-rail fence** (panel 1) | Posts 0.12 × 0.12 × 1.3 m (0.3 m sunk) every 2.5 m, lean ±3°; 2 rails 0.06 × 0.12 m at 0.45 and 0.95 m, sag 2 cm mid-span, ±1.5 cm vertical jitter per segment | Timber palette, mostly grey-silver/weathered. Both road sides along fields for about 60% of the dirt road length, plus farm paddocks. Instanced posts plus instanced rails (scaled per span). 10% of spans broken (one rail missing or dropped at one end). |
| **Dry stone wall** (panel 4) | Box segments 3 m long × 0.6 m wide × 1.0-1.3 m tall, subdivided 6 × 3 × 2. Top vertices displaced ±8 cm, sides ±3 cm. Capstones: instanced displaced boxes 0.3-0.5 m on top. | Stone texture with UV scale 1.5 m. Village gardens, churchyard, lanes between village and fields. Merged. |
| **Utility poles** | Cylinder r 0.13 m, 8.5 m tall, timber dark; crossarm 1.6 × 0.1 × 0.1 m at 7.8 m; 2 insulators per arm | Every 45 m along the dirt road's east side and into the village. Wires: catenary sag 0.6 m, 12 segments, `THREE.Line` color `#2a2826`. |
| **Hay bales** | Cylinder r 0.75 m, length 1.2 m, 20 segments, end caps rounded with slight bevel | Hay texture (spiral lines on the caps, horizontal fibre strokes on the side) `#b59a5c`/`#a3864c`. 15-30 per stubble field, scattered or in rows; some stacked in pyramids of 3. |
| **Rocks / boulders** | 3 base variants: `IcosahedronGeometry(1, 2)` displaced by 3D fBm (amp 0.25), y-scale 0.6, `mergeVertices` plus smooth normals | Rock palette; shader adds a moss tint `#5f6438` at 35% where world normal y > 0.7. Instanced, scale 0.3-2.4 m, sunk 25-35%. About 500, clustered in field corners, the hillside and copse edges. |
| **Farm clutter** | Water trough (box 2 × 0.6 × 0.6 m, timber), wooden cart (box bed 3 × 1.5 m plus 2 wheels r 0.6 m), log pile (instanced cylinders r 0.15 m × 2 m in a stack), fence gate | 1 set at the farm |
| **Village street furniture** | Lamp posts (cylinder r 0.06 m, 4.5 m, dark green-black `#2a2f2a`, curved arm and a lantern box); 3 benches; well on the square (stone cylinder r 1 m, 0.8 m tall, timber roof) | Lamps every 25 m along the paved road (panel 3 has them) |

### 9.6 Military structures

| Structure | Recipe |
|---|---|
| **Sandbag** (single instanced geometry) | `BoxGeometry(0.6, 0.15, 0.35, 4, 2, 3)`. Spherify: each vertex is pushed 40% toward the ellipsoid surface, which gives a pillow shape. Seam crease along the long axis (-1 cm). Palette `#9c8a64`, `#8a7a58`, `#a69872`, worn dark `#6e6448`; per-instance ±8%. Canvas weave texture: 256², 2 px crosshatch at ±5%. Lay in staggered courses (half-bag offset per course), each bag rotated ±4°, positioned ±2 cm. Wall: 5 courses (0.75 m) or 7 (1.05 m), 2 bags deep. About 1200 total. |
| **Bunker** (strongpoint core) | Concrete box 6 × 4 × 2.4 m sunk 1.0 m. Roof slab 6.6 × 4.6 × 0.4 m with chamfered edges. Firing slit on the south face, 3.0 × 0.3 m: a shape hole in the extruded front wall, interior dark. Sandbag ring around 3 sides. Camo net over it. Earth splat B.G and dirt A.R around a 12 m radius. |
| **Trench** | On the terrain ditch of 6.1 step 8, place revetment walls on both sides of the 3 m floor: vertical plank texture, 1.4 m tall, built as instanced 2 m panels (planks + 2 posts) following the zigzag. Add duckboard instances on the floor and sandbag courses (3 high) on the berm tops. A firing step every 6 m. |
| **Barbed wire (concertina)** | Helix: `TubeGeometry` along a helix of radius 0.45 m, pitch 0.22 m, length 8 m, tube radius 0.012, 3 radial segments, 220 tubular segments. Material `#3a3631`, metalness 0.6, roughness 0.5. Angle-iron pickets (L-profile extrude 0.04 m, 1.3 m tall) every 3 m. 3-5 coils in front of the strongpoint and trench, plus 2 at the checkpoint. Instanced. |
| **Checkpoint** | Jersey barriers: extruded profile (base 0.8 m, top 0.2 m, height 0.8 m, F-shape) × 3 m long, concrete, staggered chicane of 6. Boom gate: 6 m pole r 0.06 m, red/white 0.5 m bands (vertex color), on a 1 m post with counterweight box. Guard hut 2.5 × 2.5 × 2.6 m prefab, plaster grey `#9a988f`, flat roof, one window with sandbags to window height. A 1.2 × 0.8 m sign on a post with a canvas-drawn stop marking (generic, no real insignia). |
| **Camo nets** | `PlaneGeometry(8, 6, 16, 12)`. Drape: `y = -sag × (1 - (2u-1)²)(1 - (2v-1)²)` with sag 0.6 m, plus noise ±0.15 m, held on 4-5 poles (cylinder r 0.04 m, 2.6 m). Canvas 512² alpha texture: a net grid (2 px lines every 24 px) plus 300 leaf-shaped garnish cutouts (irregular polygons 10-30 px) in `#4d5236`, `#5e5a3d`, `#3b3f2c`, `#6b6346`, with 25% holes. `alphaTest 0.5`, alphaToCoverage, DoubleSide, castShadow with an alpha customDepthMaterial. One over the bunker, one over a vehicle position, two at the checkpoint/strongpoint. |
| **Supply clutter** | Ammo crates (0.8 × 0.4 × 0.3 m boxes, olive `#4f5236`, darker lid stripe), fuel drums (cylinder r 0.29 m, h 0.88 m, olive or rust), pallets. 20-40 instances around the strongpoint. |

### 9.7 Destruction dressing

- **Rubble mound.** A hemisphere `SphereGeometry(r, 16, 8, 0, 2π, 0, π/2)`, y-scale 0.45,
  displaced by fBm (amp 0.3). It uses a mixed stone texture whose vertex colors combine stone,
  plaster and terracotta at 60/25/15. On top:
  - 40-80 instanced chunks: displaced boxes 0.15-0.6 m, random rotation, from the stone, plaster,
    brick `#8d5a48` and terracotta palettes.
  - 3-6 timber beams (0.15 × 0.2 × 2-4 m), tilted 20-50°.
- **Street debris.** About 400 small chunk instances (0.05-0.25 m) scattered within 8 m of damaged
  façades and along the paved road near the square, denser near walls.
- **Destroyed vehicles** (3-5: 2 trucks, 1 car, 1 APC-shaped hulk; tank wrecks come from the tank
  spec using its geometry and this burnt material):
  - Truck: chassis box 6 × 0.3 × 0.9 m on 4-6 wheels (cylinders r 0.5, rims only on 40%, tyres
    burnt away), cab 2 × 2 × 2.2 m with empty window holes (shape holes), bed frame with a bent
    bow structure.
  - Car: a 4.2 × 1.7 m body made of 2 stacked boxes with a chamfered hood/trunk.
  - APC: angular hull 6.5 × 2.8 × 2 m with sloped front plates.
  - Burnt material: canvas 512² noise between `#2b2724`/`#3a332d` with rust blotches
    `#6e3f26`/`#8a5232` (30% coverage), some flaking pale primer `#7d7768`.
  - Posed tilted 3-12°, one on its side in a ditch. Scorch splat r 7 m under each.
- **Craters.** The terrain deformation of 6.1, scorch splat r 5-8 m, plus 20 small dirt-clod
  instances on the rim.
- **Ambient smoke columns** (panel 2/4) belong to the effects spec. The environment reserves anchor
  points at burning buildings, wrecks, the strongpoint and 1-2 distant village spots, and exports
  `environment.smokeAnchors: Vector3[]`.

---

## 10. Things to avoid (acceptance checklist)

- **Saturation.** No vegetation albedo with HSL saturation above 0.55 and no pure greens. Grass is
  olive and khaki, not lime. Sky is never `#87ceeb`-bright. The final image's average saturation
  should stay below the reference's.
- **Flat lighting.** Never use AmbientLight as the main fill. Shadows must be visible and directional
  everywhere within 90 m. Hills must show baked shadow sides.
- **Faceting.** Use smooth normals everywhere (`mergeVertices` before `computeVertexNormals` on
  displaced meshes). Use spherical normals on foliage. Never use `flatShading`. No visible terrain
  triangles: use central-difference normals.
- **Uniformity.** No repeated identical instances. Every instanced set gets color and scale jitter
  and rotation. No grid placement except the orchard, and even that is jittered.
- **Tiling.** No visible texture repetition at 50-300 m (dual-scale sampling plus macro map).
- **Horizon seam.** The fog and sky horizon must use the same color function. Fog is never a solid
  white or grey wall.
- **Floating or intersecting objects.** Sink everything 0.1-0.35 m. Use splat skirts (gravel/dirt)
  under buildings and props. Fence posts follow the terrain.
- **Z-fighting.** Roads and decals use polygonOffset; camera near = 0.3.
- **Aliasing.** MSAA 4×, anisotropy 8 on terrain, alphaToCoverage on all alpha cards, mipmaps on
  every canvas texture, wire tubes at least 0.012 m radius.
- **Clean, new-looking surfaces.** Every building gets a dirt base band, rain streaks and AO. Wrecks
  are matte, never glossy.
- **No real-world insignia, flags or brand names** on any texture.

---

## 11. Performance budget (60 fps, modern desktop GPU, 1440p)

| Item | Budget |
|---|---|
| Environment draw calls (main pass) | ≤ 110 |
| Shadow pass draw calls | ≤ 50 (only casters intersecting the 180 m frustum; instanced sets chunked) |
| Visible environment triangles | ≤ 2.5 M (terrain 0.53 M, trees about 1.0 M, grass about 0.35 M, buildings and props about 0.4 M) |
| Trees (full detail, playable) | ≤ 2,600 instances, split into a 3 × 3 spatial chunk grid per species so frustum culling works. Call `computeBoundingSphere()` after filling. |
| Low-LOD rim trees | ≤ 6,500 (no shadow casting) |
| Bushes | ≤ 2,500 |
| Grass/wheat/flower tufts | 29k lattice (one InstancedMesh), about 60% visible after the keep test |
| Rocks / chunks / debris | ≤ 500 / ≤ 2,500 / ≤ 600 |
| Fence posts / rails | ≤ 1,200 / ≤ 1,200 |
| Sandbags | ≤ 1,500 |
| Window units | ≤ 400 |
| Texture memory | ≤ 160 MB (2 × 2048² splat, 1024² atlas, 1024² wall, about 20 textures at 512²) |
| Load-time generation | ≤ 2.5 s total; texture and bake generation may use an OffscreenCanvas worker |
| Shader cost | Terrain: at most 16 texture fetches per fragment (2 splat + macro + 7 layers × 2 scales capped by skipping layers with weight < 0.01, + normal) |

Merge static non-instanced geometry per material. Use `InstancedMesh` for anything repeated more
than 20 times. Set `matrixAutoUpdate = false` on all static environment objects.

---

## 12. Implementation checklist (module boundaries suggested, not mandated)

- `atmosphere`: shared uniforms, `patchMaterial`, sky dome, PMREM bake, sun light and shadow follow.
- `terrain`: heightfield, `getHeight`, height texture, splat canvases, layer textures, bake, material.
- `roads`: spline ribbons (dirt and paved), curbs, sidewalks.
- `vegetation`: atlas, species geometry, distribution, foliage material and depth material, grass
  ring.
- `buildings`: textures, façade/roof builders, recipes, damage variants, merge.
- `props`: rural props, military structures, destruction dressing, `smokeAnchors`.
- Every per-frame update (shadow follow, uniforms, grass camera snap) happens in a single
  `environment.update(dt, camera)`.
