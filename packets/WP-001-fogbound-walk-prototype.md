# WP-001 Fogbound Walk prototype

Status:
ready

## Outcome

A runnable browser prototype of a first-person horror walk in Three.js: the
player walks a linear path village -> forest -> estate, then leaves (fade to an
end screen). No fail state, no combat, no inventory, no HUD beyond a minimal
start/end overlay. Target 10-20 minutes of walking.

Core principle, the glimpse economy: the player hears things far more than they
see them and never gets a clean, lingering, well-lit look at anything.

## Approved decisions (human-owned, already made)

- First-person walk in the browser using Three.js. Prototype scope.
- Linear path village -> forest -> estate -> leave. Fog gates between zones.
- Hidden attention director (spec below). Sound before sight; visual events rare,
  audio events common. Apparitions change or vanish only while unobserved.
- Four apparitions (spec below).
- Environment from primitives/procedural geometry plus heavy fog. Apparitions are
  billboarded procedural canvas textures. Audio is synthesized procedurally with
  WebAudio (spatial PannerNode footsteps, breathing, wind, drips).
- Visual reference ("Fogbound Manor"): near-monochrome blue-black/grey, heavy fog,
  wet cobbles with faint sodium-lamp reflections, a single warm amber practical
  light per scene, moonlit gabled manor in fog with one lit window, rain-streaked
  window with curtain and dark figure behind glass, dark foliage with glowing
  eyes, long wet corridor with one ceiling light and a distant figure.
  Rendering: fog, one or two point lights, vignette, film grain, desaturated grade.

## Technical constraints

- No build step: static `index.html` + ES modules, `three` from a CDN via an
  importmap pinned to an exact version (three@0.170.0 or similar established
  release, including `three/addons/`). No other runtime dependencies.
- Served by any static server (documented one-liner, e.g. `python -m http.server`).
- Smallest reasonable implementation; a handful of plain modules. No generalized
  engine/ECS/framework, no test harness.

## Acceptance

1. `index.html` served statically loads with no console errors; a start overlay
   ("click to walk") behind which the scene already renders; click acquires
   pointer lock and starts audio (WebAudio needs the gesture).
2. Controls: mouse look, WASD/arrows walk at a slow pace (~1.3 m/s), optional
   Shift brisk walk (<= 2.2 m/s). Player is constrained to the walkable path
   corridor (simple clamp to path polyline is enough; no physics engine).
3. Path length sized for roughly 10-20 minutes at walking pace (on the order of
   900-1200 m total), split across village, forest, estate. Fog gates between
   zones: fog density visibly swells and audio bed crossfades as the player passes.
4. Look and feel per reference: FogExp2 heavy fog; near-monochrome blue-black
   palette; wet-looking cobbles in the village (low roughness, faint lamp
   highlights); gabled houses with windows; dark forest with trees, stones and
   foliage; moonlit gabled estate with one lit window and a long interior or
   covered corridor with a single ceiling light; one warm amber practical light
   active per zone plus dim cool moonlight. Post-processing: vignette, film
   grain, desaturated grade (one custom ShaderPass is fine).
5. Ending: after the estate the player leaves through an exit; the screen fades
   to black and shows a short end screen with a restart option.
6. Procedural WebAudio: wind bed, drips, distant ambience per zone, the player's
   own subtle footsteps (surface varies by zone), spatialized (HRTF PannerNode)
   event sounds positioned in the world; AudioListener follows the camera.
7. Attention director implemented as specified below, driving all four
   apparitions plus additional audio-only events.
8. Minimal developer aid for playtest tuning only: a debug overlay toggled by a
   key (off by default) showing director tension, cooldowns and last event, and a
   `?zone=village|forest|estate` URL parameter to start at a zone. Nothing more.
9. README with the one command to run, controls, and a short description of the
   director and its tuning constants.

## Attention director (spec)

Hidden system, one module. Each frame it tracks:

- gaze: camera forward vector; which apparition/anchor is inside the view cone;
- dwell: how long the gaze has stayed on a target or region;
- turn-arounds: large yaw changes in a short window (e.g. > 120 deg within ~1 s);
- scare history: recent events with timestamps; a tension scalar 0..1 that rises
  with events and turn-arounds and decays over time.

Every few seconds it considers an event from a small library (data table, not a
framework), filtered by zone, anchor availability, per-event and global
cooldowns, and tension. Audio events are common; visual events are rare and are
withheld when tension is high or during the global visual cooldown. Sound before
sight: a visual event is normally preceded by a related audio cue. Apparitions
spawn only while their location is unobserved, and change or vanish only while
unobserved. "Observed" = inside a view cone toward the target within fog
visibility range and lit/visible; a brief light flicker or fog swell counts as
unobserved and may be used to deny a long look. If the player dwells or
approaches too long, the director denies the clean look this way. Apparitions
are placed at the edge of fog or light, small and low contrast.

All tuning constants live in one obvious place at the top of the module.

## Apparitions (spec)

1. Footsteps approaching and breathing behind the player (audio only,
   spatialized). Steps approach from behind (they may first echo the player's
   own steps, then fall out of sync), ending in close breathing. If the player
   turns around, everything stops instantly; nothing is there.
2. Pale woman with black hair over her face behind a window pane (rain-streaked
   glass, curtain), staring. Village or estate windows. Look away and back: gone,
   or slightly changed (e.g. closer to the glass).
3. Shadow creature half behind a stone or foliage in the forest, with luminous
   eyes. When noticed it does not move; after a beat the eyes slowly curve into a
   smile (eyes morph from round glows into upward-bowed crescents). Look away and
   back: gone.
4. Distant figure at the end of a lit corridor/path, at the edge of the light.
   Look away and back: gone or one step closer.

## Non-goals

Fail states, chase, combat, inventory, collectibles, HUD, menus beyond start/end
overlays, save system, mobile/touch support, asset files from external sources,
build tooling, test harnesses, claims that the experience is scary.

## Human gate

Scare tuning and atmosphere quality are playtest-dependent and remain a
post-integration human playtest gate. Technical acceptance is: it runs, the
systems above exist and behave as specified, no console errors.
