# Auspex: design spec

A round, heading-up tactical plot in the HUD. It paints the surroundings the pilot cannot see through smoke and walls.
A working prototype matching this spec exists in `js/auspex.js` (see "Prototype state" at the end); treat the spec as
the source of truth and the prototype as a reference.

## Placement and size
- Parent: `#hud` (so `H` hides it and `pointer-events: none` applies).
- Disc: 224 x 224 CSS px, `left: 22px; bottom: 196px` (directly above the "Engine integrity" panel, clear of the
  top-left colossus bars at 900 px height and of the PiP, which is top-right).
- Below 760 px viewport height, shrink to 176 px and `bottom: 186px`. Never overlap `#front`.
- Canvas backing store 2x the CSS size (448 x 448), clipped to the circle.
- Label tab centred on the top rim: `AUSPEX 300 M`, 10 px, letter-spacing 0.3em.
- Key line 15 px below the rim, 9 px: `VIGIL · SYNOD · ● inf ■ armour ◆ scout ▲ colossus + air` (SYNOD in foe red).

## Colours (green phosphor, distinct from the amber HUD so it reads as a separate instrument)
| use | colour |
|---|---|
| disc background | `rgba(2,14,8,0.78)` |
| rim | 3 px double `#58c98a`, outer glow `rgba(60,255,140,0.3)`, inner shadow black |
| base phosphor (footprints, rings, ticks) | `rgb(96,255,160)` at alpha 0.18–0.6 |
| allied (side 0) glyphs | `#7dffb8`; allied aircraft `#b8ffe0` |
| enemy (side 1) glyphs | `#ff5a36`; enemy aircraft `#ff9a70` |
| own engine, north mark | `#ffe0a0` |
| threat ping | `#ff3018` (colossus), `#ffb040` / `#fff0b0` flash (fusion-lance team) |
| label / key text | `#a8ffcf` / `#7ad6a2` |
Scanlines over the disc: 1 px black at alpha 0.28 every 3 px.

## Range, zoom, orientation
- Fixed range: 300 m from the player to the rim (scale = (radius - 3 px) / 300). No zoom control in v1.
  If one is added later: 150 / 300 / 600 m on a key, label updates.
- Heading-up on the TORSO AIM: screen-up is `player.aimYaw`. The plot rotates as the mouse turns; the player is fixed at centre.
- World -> plot for a point (x, z), with a = `player.aimYaw`, (px, pz) = `player.pos`, s = scale, c = centre:
  `sx = c + s * (-(x - px) * cos a + (z - pz) * sin a)`, `sy = c - s * ((x - px) * sin a + (z - pz) * cos a)`.
  A world yaw ψ appears at clockwise angle `a - ψ` from up.
- Range rings at 100 m and 200 m (alpha 0.22), 12 bearing ticks on the rim.
- North mark `N` just inside the rim at clockwise angle `a - π` (the hive burns to the north, -Z).

## Layers, back to front
1. Building footprints: axis-aligned rectangles `b.x ± b.hw`, `b.z ± b.hd` for every `G.city.buildings` entry within
   340 m. Standing (`b.alive`): fill alpha 0.26 + outline alpha 0.6. Fallen: outline only, alpha 0.18. Streets are the gaps.
2. Rings, ticks.
3. Aim cone: wedge ±0.2 rad about up, alpha 0.10, plus a centre line to the rim (alpha 0.5).
4. Units (sizes in CSS px):
   | unit | glyph | size | source |
   |---|---|---|---|
   | infantry squad | filled dot | radius 2 + 0.16 × alive (2.5–4.6) | `G.units.squads[]`: `side`, `lane` (x), `z`, `alive`, `melta` |
   | tank | filled square | 6.8 across | `G.units.tanks[]`: `side`, `x`, `z`, `alive` |
   | scout engine | diamond | 11 wide × 15 tall | `G.scouts.list[]`: `side`, `pos`, `state === 'alive'`, `tgt` |
   | colossus | chevron pointing along `torsoYaw` | 22 wide × 33 long | `G.colossi[]`: `side`, `pos`, `torsoYaw`, `state` in `alive`/`dying` |
   | aircraft | plus sign, 2 px stroke | 8 across | `G.air.list[]`: `side`, `pos`, `alive && !falling` |
   Individual troopers are NOT drawn (1,500 points is noise); one dot per squad, sized by strength.
   Colossi outside 300 m are pinned 14 px inside the rim on their bearing at 55% alpha and 14 px wide, so the pilot
   always knows where the giants are. Nothing else is pinned.
5. Own engine: leg-heading arrow at centre, 14 wide × 23 long, rotated by `angDiff(player.aimYaw, player.legYaw)`.
6. Threat pings (below).
7. Sweep (CSS, above the canvas).

## Threat pings
| trigger | drawn | data |
|---|---|---|
| A colossus is charging its lance at the player | 3 px red ring on the colossus, radius 16–24 px pulsing at ~1.1 Hz, plus a dashed red line (8/6) to centre blinking at ~2.2 Hz | `G.threat` (`{ col, t, k }`, set each frame by `colossus.js` in hunt mode, cleared at the top of `step`) |
| Enemy fusion-lance team within 110 m | amber ring on the squad, radius 7–12 px pulsing; flashes pale `#fff0b0` while a team is actually charging | `squad.melta && squad.side === 1`; `G.meltaWarn > 0` while charging |
| Enemy scout engine has the player as target | red ring on the diamond, radius 9–13 px pulsing | `scout.tgt === G.player` |
Pings are never pinned to the rim except through the colossus rule above. No audio in v1 (the HUD banners already carry it).

## Sweep
- A conic gradient wedge (phosphor at alpha 0.34 fading to 0 over 24% of the turn), `mix-blend-mode: screen`,
  rotating one revolution per 3.6 s, linear, counter-clockwise (the bright edge leads, the fade trails). Pure CSS animation, no script cost.
- The sweep is cosmetic: contacts do not fade between passes. (A persistence effect was considered and rejected:
  it hides threats for up to 3 s.)

## Update rate and budget
- Canvas redraw at 12.5 Hz (accumulate dt, redraw when >= 0.08 s). Called from the frame loop after `updateHUD`,
  skipped while the HUD is hidden. Not called from `step`, so warm-up and scripted steps cost nothing.
- Measured in the prototype: 0.05 ms per redraw (about 0.6 ms per second of play). Budget: under 0.3 ms per redraw.
- No allocations per redraw beyond closures; no per-trooper loops.

## Data read (all existing state, nothing new required)
`G.player.pos / aimYaw / legYaw`, `G.city.buildings[].{x,z,hw,hd,alive}`, `G.units.squads[].{side,lane,z,alive,melta}`,
`G.units.tanks[].{side,x,z,alive}`, `G.scouts.list[].{side,pos,state,tgt}`, `G.colossi[].{side,pos,torsoYaw,state}`,
`G.air.list[].{side,pos,alive,falling}`, `G.threat`, `G.meltaWarn`, `angDiff` from `util.js`.

## Not in v1
Zoom levels, wreck/debris marks, burning-ground patches (`G.units.patches`), objective markers, missile tracks,
line-of-sight shading, click interaction.

## Prototype state
- `js/auspex.js` (class `Auspex`, `update(dt)`), wired in `js/main.js` (`G.auspex`, called after `updateHUD` when the
  HUD is on), markup + CSS in `index.html` (`#auspex`, `#auspexDisc`, `#auspexCv`, `#auspexSweep`), preset `?shot=auspex`
  in `js/shots.js`. It runs without console errors and matches this spec except: no small-viewport size rule, and the
  key line is hard to read at 9 px.
