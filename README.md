# Fogbound Walk

A first-person horror walk prototype in Three.js (r170 from a CDN, no build step). Walk a linear path through a village, a forest and a manor estate, then leave. No fail state, no combat, no HUD. About 10-20 minutes at walking pace.

## Run

```
python -m http.server 8000
```

Open http://localhost:8000 and click to walk (needs internet for the Three.js CDN; any static server works).

## Controls

- Mouse: look (click the start overlay to capture the pointer; Esc pauses)
- W A S D or arrow keys: walk (about 1.3 m/s)
- Shift: hurry (2.0 m/s)
- `` ` `` (backtick) or F2: toggle the debug overlay (off by default)
- URL `?zone=village|forest|estate`: start at that zone, e.g. `http://localhost:8000/?zone=forest`

Use headphones: most of what happens is positional audio.

## The attention director

`director.js` is a hidden system that decides when something happens. Each frame it tracks:

- gaze: whether a target is inside the view cone and how long the player has looked straight at it (dwell)
- turn-arounds: a yaw swing over 120 degrees within one second
- a tension value (0..1) that rises with events, noticed apparitions and turn-arounds, and decays exponentially
- a short history of recent events, used to damp repeats

Every few seconds it considers one event from the `EVENTS` table (plain data at the top of the file), filtered by zone, anchor availability, per-event and global cooldowns, and tension. Audio events are common; visual events are rare, withheld at high tension and during the global visual cooldown. A visual event is announced by a related sound at its anchor first. Apparitions spawn only while their anchor is unobserved (outside the view cone, beyond fog visibility, or its lamp dimmed), and change or vanish only while unobserved: look away after noticing one and it is gone, or has moved closer to the glass or the player. If the player stares too long or comes too close, the director denies the look with a brief lamp flicker or a fog swell.

The one deliberate exception: the forest creature's eyes curve into a smile while it is being watched (the packet's spec), advancing only while observed.

Apparitions (`apparitions.js`): footsteps and breathing behind you (audio only; they stop instantly if you turn around), a pale woman behind a window, a shadow creature with luminous eyes by a stone or bush in the forest, and a distant figure at the edge of a lamp's light. Audio-only extras: distant steps, branch snap, door creak, knock, whisper, drag.

### Tuning

- `TUNING` at the top of `director.js`: cooldowns, chances, tension rates, cone angles, fog/lamp visibility thresholds, dwell and spawn ranges.
- `EVENTS` in `director.js`: per-event zones, weight, cooldown, max tension, cue sound.
- `apparitions.js` top constants: the creature's smile timing, the figure's step, and the footsteps-behind pacing.
- `FOG_BASE` in `path.js` and the grade in `post.js` for atmosphere.

## Known limits

- "Observed" ignores occluders: a target hidden behind a wall or tree but inside the cone and fog range counts as observed.
- Apparitions are flat billboards; they are meant to be glimpsed at the fog edge, not inspected.
- Scare pacing, atmosphere and audio balance are untuned and need a human playtest.
- Desktop only (keyboard and mouse with pointer lock); no touch support.
- Audio needs a user gesture, so nothing plays until you click.
