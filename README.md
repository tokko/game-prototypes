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

The one deliberate exception: the forest creature's eyes curve into a smile while it is being watched (the packet's spec), advancing only while observed.

Apparitions (`apparitions.js`): footsteps and breathing behind you (audio only; they stop instantly if you turn around), a pale woman behind a window, a shadow creature with luminous eyes by a stone or bush in the forest, and a distant figure at the edge of a lamp's light. Audio-only extras: distant steps, branch snap, door creak, knock, whisper, drag, heavy drag (fence), click (landing lamp) and the lure hum.

### Beats

`BEATS` in `director.js` is an authored table of one-shot set pieces at fixed places, the walk's backbone. Each fires once, on top of the random layer, and obeys the same rules: sound before sight, spawn or change only while the target is unobserved, look-away leaves it gone or changed, a clean lingering look is denied. A visual beat plays its cue when its window opens, then waits (it never drops on a stare or on tension) until the target is unobserved; if the player keeps watching the spot for `BEAT_FORCE` s, a lamp flicker or fog swell unobserves it. A beat not done by its window end is dropped. Random events are held back for `BEAT_QUIET` s after a beat and while one is armed or about to open, and random visuals skip a beat's anchor. The debug overlay lists each beat as waiting / armed / pending / done.

| beat (s window) | what |
| --- | --- |
| side-door (22-46) | the ajar door swings wide with a creak behind you |
| square-woman (84-106) | knock at the square window, then the woman is there (the village's only visual) |
| shrine-candle (106-130) | the shrine candle lights silently behind you |
| alley-steps (134-146) | footsteps start behind you at the alley mouth (turn round and they stop) |
| lure (160-200) | a faint whistle from the hanging lantern every 8-12 s; it can only be followed forward |
| fence (181-196) | a close heavy drag and crack beyond the smashed fence |
| clearing-creature (200-238) | branch snap, then the creature half behind the lantern-lit stone |
| hollow (262-280) | a close whisper in the hollow |
| courtyard-figure (346-366) | door creak, a figure in the lit doorway, a step closer on look-away, then gone |
| corridor-figure (376-393) | drag, a figure at the far end of the corridor at the edge of the ceiling light |
| landing-light (390-402) | the landing lamp clicks on behind you |
| corridor-door (402-414) | the shut corridor door is open once you are past it |

Escalation: the random layer scales per zone through `TUNING.ZONE` (audio chance and cooldown, visual chance, sound radius, steps-behind weight). The village is audio only and sparse, the forest has closer sounds and a rare random creature, the estate is densest with the closest sounds and steps-behind three times as likely.

### Tuning

- `BEATS` and `TUNING.ZONE` in `director.js`: move or add a beat by editing its row (window `s`, kind, anchor or toggle, cue); change the per-zone multipliers to escalate more or less. Beat sounds sit in `apparitions.js` with the other one-shots.
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
