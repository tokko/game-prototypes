# Fogbound Walk

A first-person horror walk prototype in Three.js (r170 from a CDN, no build step). Walk a linear path through a village, a forest and a manor estate, then leave. No fail state, no combat, no HUD. 432 m, about 5.5 minutes at walking pace (1.3 m/s).

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

## Route

One path, keyed by arc length `s` (`PLACES` in `path.js`; fog gates at s 152 and 300 split the zones).

- Village (0-152): street with an ajar door (17) and laundry (30), narrow lane (64-92), open square with well and shrine (92-127), cart (119), alley mouth (134).
- Forest (152-300): path, smashed fence (180-208), hanging lantern (214), clearing of standing stones (224-256), sunken hollow (268-296).
- Estate (300-432): drive, gate (320), lodge (334), courtyard (359-385), open front door (374), hall and stair landing (381-386), corridor with a 90 degree bend (404), exit door (420) and fade to the end screen.

## The attention director

`director.js` is a hidden system that decides when something happens. Each frame it tracks:

- gaze: whether a target is inside the view cone and how long the player has looked straight at it (dwell)
- turn-arounds: a yaw swing over 120 degrees within one second
- a tension value (0..1) that rises with events, noticed apparitions and turn-arounds, and decays exponentially
- a short history of recent events, used to damp repeats

Every few seconds it considers one event from the `EVENTS` table (plain data at the top of the file), filtered by zone, anchor availability, per-event and global cooldowns, and tension. Audio events are common; visual events are rare, withheld at high tension and during the global visual cooldown. A visual event is announced by a related sound at its anchor first. Apparitions spawn only while their anchor is unobserved (outside the view cone, beyond fog visibility, or its lamp dimmed), and change or vanish only while unobserved: look away after noticing one and it is gone, or has moved closer to the glass or the player. If the player stares too long or comes too close, the director denies the look with a brief lamp flicker or a fog swell.

The deliberate exceptions: the forest creature's eyes curve into a smile while it is being watched (the packet's spec), advancing only while observed, and the sobbing woman's head snaps round while she is watched (round 2).

Apparitions (`apparitions.js`): footsteps and breathing behind you (audio only; they stop instantly if you turn around), a pale woman behind a window, a shadow creature with luminous eyes by a stone or bush in the forest, and a distant figure at the edge of a lamp's light. Audio-only extras: distant steps, branch snap, door creak, knock, whisper, drag, heavy drag (fence), click (landing lamp), stone scrape, the lure hum and the sobbing woman's sting. The five round-2 apparitions (below) are separate actors with slots of their own and never occupy the director's single `active` slot.

### Painted apparitions (`assets/apparitions`)

The woman, the creature (body, paw) and the tall figure (leaning in a doorway, standing, hand on the post) are painted PNG billboards (straight alpha, unlit, fogged), not canvas textures; `assets/apparitions/SPEC.md` has plane sizes, pivots and what must not change, and `paint_apparitions.py` regenerates them. Only the creature's eyes stay procedural, because their smile is animated.

### The fleshbeast (`assets/fleshbeast.glb`, `beast.js`)

One fused pile of pale bodies that scuttles in stop-start bursts. It never catches you: it keeps 2.8 m away, shows only in part (lamp-light edge, fog, behind walls, banks and corners), and bolts or vanishes on a lamp flicker when stared at. The GLB is exported by `tools/export_fleshbeast.py` (Blender). `beast.js` runs short SCRIPTS (moving goals in the path frame, stepped at about 12 Hz) started by beats, and borrows the director's observed test and flicker / fog-swell denial. Its voice (`audio.choir`, about 12 detuned formant voices that moan, sigh and wail, thinning with distance, hushed on a freeze) and the claw skitter live in `audio.js`. Beats: beast-warn (240-262, distant moaning, nothing seen), beast-hollow (262-296, first sighting along the banks), beast-courtyard (356-376, along the courtyard walls), beast-corridor (394-420, the payoff on the corridor ceiling), plus a rare random glimpse (s 296-344, `BEAST_GLIMPSE_*` in `TUNING`).

### Round-2 apparitions (`assets/round2`, `apparitions.js` `R.*`)

Each is an actor with `start / update / release`; beats start them (`kind: 'actor'`), and they apply the director's rules themselves through its `host` (observed test, gaze, flicker denial). Art and sizes: `assets/round2/SPEC.md`. Constants are at the top of `apparitions.js`.

- Weeping angel (beat `angel`, village lane, 48-84): after a faint stone scrape it stands far behind you (15.5 m) in one of four poses. It keeps pace only while unobserved and freezes the moment it is observed; look back, look away for 0.6 s, and the next pose is 2-5 m closer (15.5, 11.8, 8.0, 3.2 m). It stops about 3 m short and never touches you; a long stare is taken away by a lamp flicker (it moves on during the blink), and once the window closes it leaves on the first look-away or flicker.
- Woman in the ceiling corner (`landing-woman`, 390-410, after `landing-light`): once the landing lamp is on and the corner is unobserved she is crouched in the landing's upper corner, tilted down at you; gone when you look away and back, or when the lamp flickers (a long look forces it).
- Sobbing woman (`lodge-sobbing`, 316-346): from s 316 procedural sobbing comes from the open lodge window (`audio.sobber`: catching inhales, trembling voiced sobs, hiccups, voice cracks, irregular, spatialised). After about 1-1.5 s of gaze at 5-16 m she can be made out (a fade); after 2-3 s the sobbing stops dead, 0.3-0.5 s of silence, her head snaps round (a map swap, the one deliberate change under observation), a short sting, a 0.5-0.8 s hold, then she is gone. If nobody looks, the sobbing just fades after the window.
- Forest wraith (`wraith` beat 160-182, and the random event `wraith-drift` in the forest): a 3-6 s breathy sigh (`audio.sigh`, formant-bent noise on a moving panner) crosses the path at 15-30 m while a pale shape drifts between the trunks, its opacity tied to fog; gone if gazed at for more than 1 s.
- Crossers (random event `crosser`, every zone including the village, cooldown 60-90 s): a runner, a low crawler or a face behind a window pane dashes along the plane's own axis for 0.25-0.6 s in peripheral view (30-48 degrees off the gaze, beyond 9 m, never inside the gaze cone). Its footfalls come first, and it is gone the frame the gaze swings onto it. Spawn spots are ray-tested against the solid world, so it only crosses real gaps.

### Beats

`BEATS` in `director.js` is an authored table of one-shot set pieces at fixed places, the walk's backbone. Each fires once, on top of the random layer, and obeys the same rules: sound before sight, spawn or change only while the target is unobserved, look-away leaves it gone or changed, a clean lingering look is denied. A visual beat plays its cue when its window opens, then waits (it never drops on a stare or on tension) until the target is unobserved; if the player keeps watching the spot for `BEAT_FORCE` s, a lamp flicker or fog swell unobserves it. A beat not done by its window end is dropped. Random events are held back for `BEAT_QUIET` s after a beat and while one is armed or about to open, and random visuals skip a beat's anchor. The debug overlay lists each beat as waiting / armed / pending / done.

| beat (s window) | what |
| --- | --- |
| side-door (22-46) | the ajar door swings wide with a creak behind you |
| square-woman (84-106) | knock at the square window, then the woman is there (the village's only visual) |
| shrine-candle (106-130) | the shrine candle lights silently behind you |
| angel (48-84) | stone scrape, then a weeping angel behind you in the lane, closer each time you look back |
| alley-steps (134-146) | footsteps start behind you at the alley mouth (turn round and they stop) |
| lure (160-200) | a faint whistle from the hanging lantern every 8-12 s; it can only be followed forward |
| wraith (160-182) | a long sigh crosses the path in the trees, a faint pale shape between the trunks |
| fence (181-196) | a close heavy drag and crack beyond the smashed fence |
| clearing-creature (200-238) | branch snap, then the creature half behind the lantern-lit stone |
| beast-warn (240-262) | distant moaning of the fleshbeast, nothing seen |
| hollow (262-280) | a close whisper in the hollow |
| beast-hollow (262-296) | the fleshbeast scuttles along the banks, driven off by a stare |
| lodge-sobbing (316-346) | sobbing from the open lodge window; look in and it stops, her head snaps round, gone |
| courtyard-figure (346-366) | door creak, a figure in the lit doorway, a step closer on look-away, then gone |
| beast-courtyard (356-376) | the beast along the courtyard walls and behind you in the porch |
| corridor-figure (376-393) | drag, a figure at the far end of the corridor at the edge of the ceiling light |
| landing-light (390-402) | the landing lamp clicks on behind you |
| landing-woman (390-410) | in the lit landing corner behind you, if you look back; gone on look-away or flicker |
| beast-corridor (394-420) | the beast comes round the bend and onto the ceiling, a flicker, gone |
| corridor-door (402-414) | the shut corridor door is open once you are past it |

Escalation: the random layer scales per zone through `TUNING.ZONE` (audio chance and cooldown, visual chance, sound radius, steps-behind weight). The village is audio only and sparse, the forest has closer sounds and a rare random creature, the estate is densest with the closest sounds and steps-behind three times as likely.

### Tuning

- `BEATS` and `TUNING.ZONE` in `director.js`: move or add a beat by editing its row (window `s`, kind, anchor or toggle, cue); change the per-zone multipliers to escalate more or less. Beat sounds sit in `apparitions.js` with the other one-shots.
- `TUNING` at the top of `director.js`: cooldowns, chances, tension rates, cone angles, fog/lamp visibility thresholds, dwell and spawn ranges.
- `EVENTS` in `director.js`: per-event zones, weight, cooldown, max tension, cue sound.
- `apparitions.js` top constants: the creature's smile timing, the figure's step, the footsteps-behind pacing, and the round-2 actors (angel gaps and timings, ceiling tilt, sobbing gaze / turn / silence / hold times, wraith bearing, speed and fog gain, crosser angle, distance and time).
- `TUNING.SCRIPTED_*` and the `kind: 'scripted'` rows of `EVENTS` (wraith-drift, crosser): chance, global cooldown, tension cap and per-event cooldown (a `[min, max]` range is allowed). `BEAST` and `SCRIPTS` in `beast.js` tune the fleshbeast.
- `FOG_BASE` in `path.js` and the grade in `post.js` for atmosphere.

## Known limits

- "Observed" ignores occluders: a target hidden behind a wall or tree but inside the cone and fog range counts as observed.
- Apparitions are flat billboards; they are meant to be glimpsed at the fog edge, not inspected.
- Scare pacing, atmosphere and audio balance are untuned and need a human playtest. The sobbing, sigh and sting levels were set by metering, not by ear, and nothing here has been judged for scariness.
- Mouse look and pointer lock are not human-validated for the round-2 beats: they were driven with scripted yaw, not a real mouse, and the angel, ceiling woman and sobbing woman depend on looking back or into a window.
- The ceiling woman is small and seen only through the corridor mouth (about s 390-394). Crossers never appear in the straight lane, street or corridor (no peripheral gaps there), and the beats keep the random layer quiet for most of the route, so crossers and the random wraith are rare.
- Desktop only (keyboard and mouse with pointer lock); no touch support.
- Audio needs a user gesture, so nothing plays until you click.
