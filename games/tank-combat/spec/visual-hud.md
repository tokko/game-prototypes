# Visual Spec: HUD and 2D UI

Scope: every 2D element drawn over the Three.js canvas. DOM/CSS for text panels, one full-screen 2D canvas for reticles and world-anchored markers, one canvas for the minimap, one canvas for the compass, inline SVG for icons and the radial menu.
Reference: `reference.png` (6-panel mood board). Target look: realistic modern military, minimal, small white type with soft shadow, no heavy frames, dark translucent tiles only where grouping is needed.

All dimensions below are **px at 1920x1080** ("px@1080") unless stated otherwise.

---

## 0. Priority order

Build in this order; each tier is usable on its own.

| Tier | Items |
|---|---|
| P0 | §1 tokens + scaling, §2 root/layers, §5 vehicle status (incl. hull), §6 ammo slots + loading, §7 third-person reticle, §8 gunner optics (crosshair, range box, magnification, ammo list, ready lamp, vignette), §14 click-to-play / pause |
| P1 | §3 mission panel (static list), §4 compass, §10 minimap, §11 hit markers + damage direction, §12 enemy spotted marker, §15 end screens, §9 ammo radial menu |
| P2 | §3.3 objective-complete / new-objective animations, §8.4 ballistic ladder + stadiametric scale, §8.7 zoom transition polish, §16 thermal (optional, may be skipped) |

---

## 1. Design tokens

### 1.1 Font

`font-family: "Barlow", "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;`
Load from Google Fonts: Barlow weights 400, 500, 600 only.

Justification: Barlow is a slightly narrow DIN-style grotesk (California road-signage lineage), which reads as "military instrument" without the sci-fi feel of Rajdhani; it stays legible at 12-14 px, where Barlow Condensed gets too tight. The reference HUD type is a plain neutral grotesk, and Barlow matches that while having more character than system sans. Fallback stack keeps the HUD working offline.

Rules:
- All changing numbers: `font-variant-numeric: tabular-nums;` and a fixed `min-width` on the value span (in `ch`) so text never jitters.
- Uppercase labels: `letter-spacing: 0.06em`. Small caps-style headers (banners, screen titles): `0.18em - 0.24em`.
- Canvas text: use the same family string; do the first canvas draw after `document.fonts.ready`.

### 1.2 Scaling rule

```css
:root {
  --u: clamp(0.6px, min(calc(100vh / 1080), calc(100vw / 1920)), 2px);
  --m: calc(40 * var(--u));          /* screen-edge safe margin */
}
```
Every px@1080 value N is written as `calc(N * var(--u))`. Canvases read the same factor in JS: `u = clamp(min(innerHeight/1080, innerWidth/1920), 0.6, 2)`, and set backing size to `cssSize * devicePixelRatio`. Line widths on canvas: `Math.max(1, w * u) * dpr` device px.
Ultrawide: elements stay anchored to their edge/center; nothing stretches.

### 1.3 Colors

| Token | Value | Use |
|---|---|---|
| `--c-text` | `#F2F1EC` | All primary HUD text and icons |
| `--c-text-dim` | `rgba(242,241,236,0.62)` | Secondary text, completed objectives, minor ticks |
| `--c-text-off` | `rgba(242,241,236,0.32)` | Empty / disabled |
| `--shadow-text` | `0 1px 2px rgba(0,0,0,0.70), 0 0 8px rgba(0,0,0,0.35)` | `text-shadow` on all free-floating text |
| `--c-panel` | `rgba(12,14,16,0.55)` | Tile / panel fill |
| `--c-panel-strong` | `rgba(12,14,16,0.72)` | Minimap bg, radial segments, range box |
| `--c-panel-line` | `rgba(255,255,255,0.10)` | 1 px tile border |
| `--c-select-fill` | `rgba(255,255,255,0.16)` | Selected / hovered fill |
| `--c-select-line` | `rgba(255,255,255,0.85)` | Selected / hovered border |
| `--c-amber` | `#F2A93B` | Warnings: RPM redline, hull 26-50 %, module damage, gun cannot reach |
| `--c-red` | `#E5372E` | Enemies, hull <= 25 %, damage taken, destroyed |
| `--c-blue` | `#3A8DFF` | Friendly, route, objectives |
| `--c-blue-outline` | `rgba(5,15,35,0.55)` | Dark outline under blue lines |
| `--c-ok` | `#A8D88A` | Objective-complete check (transient only) |
| `--c-reticle` | `rgba(8,8,8,0.88)` | Gunner optics reticle lines/text |
| `--c-reticle-halo` | `rgba(255,255,255,0.14)` | 3 px halo stroked under optics reticle |
| `--c-dim-screen` | `rgba(6,8,10,0.62)` | Pause / end screen backdrop |

No other hues. Accent for selection is white (brightness), not a color, matching the reference.

### 1.4 Motion

| Token | Value |
|---|---|
| `--t-fast` | 120 ms |
| `--t-med` | 250 ms |
| `--t-slow` | 400 ms |
| `--ease-out` | `cubic-bezier(0.215, 0.61, 0.355, 1)` (easeOutCubic) |
| `--ease-inout` | `cubic-bezier(0.65, 0, 0.35, 1)` |
| `--ease-back` | `cubic-bezier(0.34, 1.56, 0.64, 1)` (pop-in only) |

Only animate `opacity` and `transform` in DOM.

---

## 2. Root structure and layer order

```
#hud            position:fixed; inset:0; pointer-events:none; z-index:10; color:var(--c-text); text-shadow:var(--shadow-text)
  #fx-canvas    full-screen 2D canvas: reticles, hit markers, damage arcs, spotted markers, optics reticle   (z 1)
  #vignette     optics vignette div                                                                       (z 2)
  #objectives   top-left                                                                                  (z 3)
  #compass      top-center canvas                                                                         (z 3)
  #banner       top-center notification                                                                   (z 4)
  #status       bottom-left                                                                               (z 3)
  #ammo-slots   bottom-right, left of minimap                                                             (z 3)
  #minimap      bottom-right canvas                                                                       (z 3)
  #optics-ui    range box, magnification, optics ammo list, ready lamp                                    (z 3)
  #radial       ammo radial SVG                                                                           (z 5)
  #overlay      click-to-play / pause / end screens; pointer-events:auto when visible                     (z 20)
<svg id="icons" hidden> <symbol> defs for ammo icons (§6.3) </svg>
```

Visibility by mode (anything not listed is hidden; hide with `opacity 0` over `--t-fast`):

| Mode | Visible |
|---|---|
| Third person | objectives, compass, banner, status, ammo-slots, minimap, 3P reticle, spotted markers, hit/damage |
| Gunner optics | vignette, optics reticle, optics-ui, banner, spotted markers, hit/damage |
| Radial open | everything of current mode + radial (aim input frozen) |
| Paused / end | overlay only (HUD at opacity 0.25 behind for pause, 0 for end screens) |

DOM text updates: write `textContent` only when the displayed string changes. Status values poll at 10 Hz max.

---

## 3. Mission panel (top-left)

### 3.1 Layout
- Anchor: `left: var(--m); top: calc(32 * var(--u))`. Max width 460. No background.
- Rows: line-height 28, gap 2. Max 4 rows (primaries first, then optionals).
- Primary row: 6x6 filled circle (`--c-text`), vertically centered, then 10 gap, text 18 / 500 / `0.01em`.
- Optional row: 12x12 square, 1.5 px border `--c-text`, radius 1, then 10 gap, text 17 / 400 at opacity 0.85, prefixed "Optional: ".
- Marker column width 16 so text left edges align.
- Text sentence case, as in reference ("Reach the observation hill").

### 3.2 States
| State | Visual |
|---|---|
| Active | as above |
| Updated (new progress e.g. "2/3") | count part flashes `--c-text` at opacity 1 with a 1-frame scale 1.08 -> 1 over 200 ms |
| Completed | marker becomes check, text `--c-text-dim`, strike-through, then row removed (see 3.3) |
| Failed (if code supports) | marker becomes X in `--c-red`, text dim, removed like completed |

Check glyph: SVG 12x12, polyline `2,6.5 5,9.5 10,3`, stroke 1.8, round caps, `stroke-dasharray` = length for draw-on.

### 3.3 Animations (P2)
Objective complete:
1. 0 ms: marker cross-fades (120 ms) to check in `--c-ok`; check stroke draws 250 ms `--ease-out`.
2. 100 ms: 1 px strike line (`--c-text-dim`) scales X 0 -> 1 from left, 300 ms. Text color -> `--c-text-dim` 300 ms.
3. 400 ms: check color settles to `--c-text-dim` over 600 ms.
4. 2000 ms: row fades out + collapses height to 0, 300 ms `--ease-inout`. Rows below slide up via the collapse.
5. Fire the "OBJECTIVE COMPLETE" banner (3.4) at 0 ms.

New objective:
1. Row inserted at its position with height 0 -> 28 (250 ms), then content fades in + `translateX(-8px -> 0)` 250 ms `--ease-out`.
2. Behind the row, a highlight `linear-gradient(90deg, rgba(255,255,255,0.18), transparent 80%)` fades 0 -> 1 -> 0 over 1200 ms.
3. Fire the "NEW OBJECTIVE" banner.

### 3.4 Notification banner
- Position: centered, `top: calc(104 * var(--u))` (below compass). Max width 720. No background; a soft backing `radial-gradient(ellipse at center, rgba(0,0,0,0.35), transparent 70%)` 120 px tall behind text.
- Line 1 (label): 13 / 600 / `0.24em` uppercase, `--c-text-dim`. Values: `NEW OBJECTIVE`, `OBJECTIVE COMPLETE`, `OPTIONAL OBJECTIVE COMPLETE`. (No banner for spotting; markers handle it.)
- 1 px rule below label: 48 wide, `--c-text-dim`, margin 6 auto 8.
- Line 2: objective text 24 / 500, `--c-text`. For "complete", prepend the 16 px check in `--c-ok`.
- Timing: in 250 ms (`opacity` 0 -> 1, `translateY(-8px -> 0)`, `--ease-out`), hold 3500 ms, out 400 ms (opacity only).
- Queue: one at a time, FIFO, 200 ms gap. Visible in both third-person and optics.

---

## 4. Compass tape (top-center)

- Canvas 480 x 44, centered, `top: calc(28 * var(--u))`.
- Visible span 90 deg (5.333 px/deg). Heading source: **camera yaw** (where the player looks), 0 = North, clockwise.
- World convention (shared with minimap): North = -Z, East = +X. `bearing = atan2(dx, -dz)` in degrees, normalized 0-360.
- Baseline: none (reference has no line). Ticks hang from y = 22:
  - every 5 deg: 1 px x 4, `--c-text-dim`
  - every 15 deg: 1.5 px x 8, `--c-text`
- Labels above ticks, baseline y = 16, centered on tick:
  - 0/90/180/270: `N E S W`, 15 / 600
  - 45/135/225/315: `NE SE SW NW`, 14 / 600
  - other 15 deg multiples: number (e.g. `285`), 14 / 500, `--c-text` at 0.85
- Center indicator: 2 px x 12 vertical line at x = 240, y 22-34, `--c-text`; below it heading readout `312` 12 / 500 `--c-text-dim` (baseline y = 44).
- Edge fade: draw then `globalCompositeOperation = 'destination-in'` with a horizontal gradient: alpha 0 at 0 %, 1 at 18 %, 1 at 82 %, 0 at 100 %.
- Markers on the tape (y = 30, below ticks): current objective = blue diamond 8 px (with 1 px `--c-blue-outline`); spotted enemies = red diamond 6 px. Clamp to tape edge with alpha 0.5 when outside span.
- Text shadow on canvas: `shadowColor rgba(0,0,0,0.7)`, `shadowBlur 3*u`, `shadowOffsetY 1*u`.

---

## 5. Vehicle status (bottom-left)

- Anchor: `left: var(--m); bottom: var(--m)`. No background. Line-height 28, text 19 / 500 / `0.04em` uppercase.
- Lines (top to bottom):
  1. `HULL 100%` (min-width value 4ch)
  2. `GEAR 4` (values: `R`, `N`, `1`..`n`)
  3. `RPM 2200` (rounded to nearest 50, min-width 4ch)
  4. `SPD 28 km/h` (absolute, integer, `km/h` lowercase at 16 / 500 `--c-text-dim`)
- Label and value same color (reference). 0.5em gap between label and value.
- Hull color thresholds: > 50 % `--c-text`; 26-50 % `--c-amber`; <= 25 % `--c-red`.
- RPM >= 90 % of redline: value `--c-amber`.
- Module damage (only if the sim exposes it): append tags to the HULL line, 14 / 600 `--c-amber` (or `--c-red` if destroyed), separated by 12 px: `ENGINE`, `TRACK L`, `TRACK R`, `TURRET`, `GUN`.
- Damage flash on taking a hit: HULL line text goes `--c-red` at opacity 1 for 150 ms then eases back to its threshold color over 600 ms; simultaneously `translateX` shake 0 -> 3 -> -2 -> 0 px over 240 ms.
- Persistent low-health cue: hull <= 25 % adds an edge vignette `radial-gradient(ellipse at center, transparent 60%, rgba(229,55,46,0.12) 100%)` on `#vignette`'s sibling layer, breathing 0.08 <-> 0.14 opacity, 2 s period. Visible in both views.

---

## 6. Ammo slots (bottom-right, left of minimap)

### 6.1 Layout
- Row of 4 tiles, gap 6. Right edge at `right: calc(40 + 260 + 16) * u` (16 px gap to minimap), bottom aligned with minimap bottom (`bottom: var(--m)`).
- Tile 72 x 84, fill `--c-panel`, border 1 px `--c-panel-line`, radius 2.
- Tile contents (positions relative to tile):
  - Hotkey number: top 6, left 8, 14 / 600.
  - Count: top 6, right 8, 14 / 500 tabular.
  - Icon: SVG 24 x 40 centered at x 36, top 22. Fill `currentColor`.
  - Name: bottom 6, centered, 12 / 600 / `0.06em` uppercase (`APFSDS`, `HEAT`, `HE`, `SMOKE`).

### 6.2 States
| State | Visual |
|---|---|
| Idle | as layout |
| Loaded + ready (selected) | fill `--c-select-fill`, border 1.5 px `--c-select-line` |
| Loading (selected) | fill `--c-select-fill`, border 1.5 px dashed `rgba(255,255,255,0.6)`; 3 px progress bar inset 4 px from left/right, bottom 2 px, `--c-text` fill grows 0 -> 100 % linearly over reload time, track `rgba(255,255,255,0.15)` |
| Ready transition | border becomes solid; fill flashes `rgba(255,255,255,0.32)` -> `--c-select-fill` over 300 ms `--ease-out`; progress bar fades 150 ms |
| Empty (count 0) | icon + name at `--c-text-off`, count `0` in `--c-red`; still selectable via key only if code allows, otherwise key press flashes border `--c-red` 300 ms |
| Low (count <= 2) | count `--c-amber` |

Changing selection: previous tile loses selection instantly; new tile enters Loading.

### 6.3 Ammo icons (SVG symbols, viewBox `0 0 24 48`, fill `currentColor`)

Silhouettes of the projectile with a short case stub, flat fill, no outlines. Reference shows small grouped rounds; a single clear silhouette reads better at 40 px.

```svg
<symbol id="ico-apfsds" viewBox="0 0 24 48">
  <!-- long rod dart with fins -->
  <path d="M12 2 L13.4 7 V33 L16.5 40 V43 H7.5 V40 L10.6 33 V7 Z"/>
  <!-- sabot petals (dimmer) -->
  <path opacity="0.55" d="M7.5 15 L10 12.5 V29 H7.5 Z M16.5 15 L14 12.5 V29 H16.5 Z"/>
  <rect x="7" y="44" width="10" height="3" rx="0.5"/>
</symbol>

<symbol id="ico-heat" viewBox="0 0 24 48">
  <!-- standoff probe + conical shaped-charge nose -->
  <path d="M11.2 2 H12.8 V10 L16.5 19 L17 23 V38 H7 V23 L7.5 19 L11.2 10 Z"/>
  <rect x="6" y="39" width="12" height="8" rx="0.8" opacity="0.7"/>
</symbol>

<symbol id="ico-he" viewBox="0 0 24 48">
  <!-- rounded ogive with fuse tip and driving band -->
  <rect x="11" y="2" width="2" height="3"/>
  <path d="M12 5 C15.3 8.5 17 13.5 17 19 V38 H7 V19 C7 13.5 8.7 8.5 12 5 Z"/>
  <rect x="7" y="33" width="10" height="1.6" fill="#000" opacity="0.45"/>
  <rect x="6" y="39" width="12" height="8" rx="0.8" opacity="0.7"/>
</symbol>

<symbol id="ico-smoke" viewBox="0 0 24 48">
  <!-- canister + three puffs -->
  <circle cx="9" cy="11" r="3.2" opacity="0.7"/>
  <circle cx="14.5" cy="8" r="3.8" opacity="0.7"/>
  <circle cx="17" cy="13" r="2.6" opacity="0.7"/>
  <rect x="7" y="18" width="10" height="27" rx="1.5"/>
  <rect x="7" y="22" width="10" height="1.4" fill="#000" opacity="0.45"/>
</symbol>
```
Usage: `<svg width=24 height=40><use href="#ico-apfsds"/></svg>` (scaled via `calc(* var(--u))`). The radial menu uses the same symbols at 1.25x.

---

## 7. Third-person reticle (drawn on `#fx-canvas`)

Two independent marks:

1. **Aim point** (where the camera ray hits; the turret's target): fixed at screen center. 4 px diameter dot, `--c-text` at 0.9, with 1 px `rgba(0,0,0,0.5)` outline.
2. **Gun circle** (where the barrel actually points): world point = raycast from muzzle along barrel axis (first hit or 2000 m), projected to screen. No smoothing; show the truth so turret lag is visible.
   - Circle diameter 30, stroke 1.5 `--c-text` at 0.85, under-stroke 3.5 `rgba(0,0,0,0.35)`.
   - Aligned (distance to center <= 3 px): stroke opacity 1.0 and diameter 28 (lerp over 100 ms).
   - Gun cannot reach aim (elevation/depression limit): stroke `--c-amber`, dashed `[4, 3]`.
   - Off-screen: clamp to a 60 px inset from the screen edge, opacity 0.5.
3. **Loading arc** on the gun circle:
   - Reloading: whole circle at opacity 0.3; progress arc from 12 o'clock clockwise at opacity 0.95, radius +0, width 2.
   - Ready: arc completes, circle pulses scale 1.15 -> 1.0 over 180 ms `--ease-out`.
   - Ammo empty for selected type: circle `--c-text-off`, small `EMPTY` 11 / 600 `0.1em` below circle (+24 px), `--c-red`.

No range text and no lead ticks in third person.

---

## 8. Gunner optics overlay

Mode replaces third-person HUD (see §2 table). Reticle is drawn on `#fx-canvas`; text elements are DOM in `#optics-ui`.

### 8.1 Angular scale (first-focal-plane)
The reticle is defined in milliradians and scales with zoom, so stadia stay correct at every magnification and animate naturally during zoom.

```
pxPerMrad = (canvasCssHeight / 2) / Math.tan(camera.fov * Math.PI / 360) / 1000
```
Recompute every frame from the actual camera fov. Line widths and font sizes do NOT scale with zoom (they use `u`).

Magnification-to-FOV contract (for the code owner; display only depends on actual fov): `vFov(m) = 2 * atan(tan(25 deg) / m)`. Levels: `3.0x` and `6.0x` (default on entry: 6.0x). At 6.0x on 1080p, pxPerMrad ~ 6.95.

### 8.2 Main crosshair
Draw every stroke twice: halo pass `--c-reticle-halo` width 3, then line pass `--c-reticle` width 1.25 (both `* u`).
- Vertical line: full screen height, gap from -2 to +2 mrad around center (skip the gap segment).
- Horizontal line: full screen width, same 2 mrad center gap.
- Aim chevron: inverted V, apex exactly at screen center, arms 1.5 mrad long at 45 deg down-left and down-right, width 1.5.
- Mil ticks on horizontal line, out to +-40 mrad from center:
  - every 5 mrad: tick up from the line, 1.5 mrad tall
  - every 10 mrad: tick up 3 mrad and down 1 mrad (forms the reference's "upside-down T" marks)
  - no labels.
- Beyond +-40 mrad the line is plain.

### 8.3 Range box
- Centered on the vertical line, box center at `y = 50% - 240 px@1080` (fixed screen offset, not mrad). The vertical line passes behind it (box is opaque enough to cover).
- Box: padding 3 x 8, fill `--c-panel-strong`, border 1 px `rgba(255,255,255,0.35)`, radius 2.
- Text: `1832 m`, 16 / 500 tabular, `--c-text`; number min-width 4ch, ` m` part 14 / 500 `--c-text-dim`.
- Value: raycast distance at screen center, updated at 4 Hz, rounded to 1 m. No hit or > 5000 m: `---- m` at `--c-text-dim`.
- On value change > 50 m: number fades 0.4 -> 1 over 120 ms (simulates a new lase).

### 8.4 Ballistic ladder and stadiametric scale (P2)
**Ballistic ladder** (holdover for the selected ammo), on the vertical line below center:
- For each range R in steps of 500 m from 500 to the ammo's max (default 3000; HE 4000), draw a horizontal tick at `y = center + dropMrad(ammo, R) * pxPerMrad`.
  - 1000 m multiples: 4 mrad wide, centered on the vertical line, label `10`, `20`, `30` (hundreds of m) 12 / 600 `--c-reticle` at x = +3 mrad + 4 px, vertically centered.
  - 500 m odd steps: 2 mrad wide, no label.
  - Skip any tick closer than 4 px to the previous one.
- `dropMrad` source: preferably sampled from the game's own projectile sim at ammo-switch time (fire a virtual round, record drop angle at each R). Fallback (no drag): `dropMrad = 9.81 * R / (2 * v * v) * 1000` with the ammo's muzzle velocity `v`.
- Under the ladder's last tick: ammo short name `APFSDS` 11 / 600 `0.08em` `--c-reticle`, so the player knows which scale is shown.

**Stadiametric range scale** (estimate range from a 2.3 m tall target), lower-left of center:
- Baseline: horizontal 1.25 px line at y = center + 8 mrad, from x = center - 34 mrad to center - 10 mrad.
- For R = 500, 1000, 1500, 2000, 2500, 3000 at x = center - 10 - (i * 4.5) mrad (i = 0..5, 500 m nearest center): vertical tick rising from baseline, height `2300 / R` mrad.
- Labels below baseline (+2 mrad + 2 px): `5 10 15 20 25 30`, 11 / 600 `--c-reticle`, only every other one if spacing < 18 px (3.0x).
- Usage: place the target's base on the baseline; the tick whose top meets the target's turret roof gives range.

### 8.5 Enemy marker in optics
Same red diamond as §12 (no distance label; the range box covers it). It sits above the target as in the reference.

### 8.6 Optics text elements
- **Magnification**: `6.0x`, `right: calc(48 * u); bottom: var(--m)`, 22 / 500 tabular. On change: crossfade 120 ms.
- **Ammo list**: `left: var(--m); bottom: var(--m)`, panel width 220, fill `--c-panel`, border 1 px `--c-panel-line`, radius 2, padding 6 0.
  - Rows 30 tall, 18 / 500. Columns: number (left 12, width 24), name (left 40), count (right 14, tabular).
  - Selected row: fill `--c-select-fill`, 2 px left bar `--c-text`.
  - Empty row: `--c-text-off`; low count (<= 2): count `--c-amber`.
- **Ready lamp** (loading status), centered horizontally, top at `50% + 96 px@1080`:
  - Loading: `LOADING` 13 / 600 `0.18em` `--c-amber`, below it a 64 x 2 bar: track `rgba(255,255,255,0.18)`, fill `--c-amber` growing with reload progress.
  - Ready: `READY` in `--c-text`, bar fill `--c-text` full; holds 1200 ms then text fades to 0 over 400 ms, leaving only a 6 x 6 solid square `--c-text` at opacity 0.6 (lamp on).
  - Empty: `NO AMMO` in `--c-red`, no bar.

### 8.7 Vignette and zoom transition
- `#vignette` (optics only): `background: radial-gradient(ellipse 78% 88% at 50% 50%, transparent 55%, rgba(0,0,0,0.45) 82%, rgba(0,0,0,0.85) 100%);` Rectangular soft falloff, matching the reference; no circular eyepiece mask.
- Optional subtle lens tint: same div adds `box-shadow: inset 0 0 calc(120 * u) rgba(0,0,0,0.35)`.
- **Enter optics** (total 300 ms):
  1. 0-120 ms: a full-screen black layer (`#vignette::after`) opacity 0 -> 1, `--ease-inout`; third-person HUD fades out in parallel.
  2. At 120 ms: switch camera to gunner view at fov = target fov * 1.25.
  3. 120-300 ms: black layer 1 -> 0; camera fov eases to target (180 ms `--ease-out`); optics-ui fades in. Reticle scales with fov automatically (FFP).
- **Exit optics**: same black dip, 100 ms in / 160 ms out, no fov tween.
- **Magnification change**: fov tween 200 ms `--ease-out`; reticle rescales live; mag text updates at tween start.

---

## 9. Ammunition radial menu (hold R)

### 9.1 Geometry (SVG, centered on screen, 440 x 440 viewBox centered at 0,0)
- Backdrop: `radial-gradient(circle at center, rgba(0,0,0,0.38) 0, rgba(0,0,0,0.38) 200px, transparent 330px)` (px@1080).
- Ring: inner radius 78, outer radius 190. 4 annular segments, 90 deg each minus 4 deg gap (2 deg trimmed each side).
- Placement clockwise from top, matching hotkeys: 1 APFSDS top (centered -90 deg), 2 HEAT right (0 deg), 3 HE bottom (90 deg), 4 SMOKE left (180 deg).
- Segment path: `M` outer start, outer arc, line to inner end, inner arc back, `Z`.
- Segment content centered at radius 134 on the bisector, stacked: icon (30 x 50, the §6.3 symbol), name 15 / 600 `0.06em`, count `x18` 14 / 500 tabular `--c-text-dim`.
- Center dead-zone disc: radius 70, fill `--c-panel-strong`, border 1 px `--c-panel-line`.

### 9.2 States
| State | Visual |
|---|---|
| Idle segment | fill `--c-panel-strong`, stroke 1 px `--c-panel-line` |
| Hovered | fill `--c-select-fill` over panel, stroke 1.5 px `--c-select-line`, segment translated 6 px outward along its bisector, 100 ms `--ease-out` |
| Currently loaded | 3 px arc in `--c-text` along the inner edge (radius 81), small `LOADED` 10 / 600 `0.14em` `--c-text-dim` under the count |
| Empty | content `--c-text-off`, count `x0` in `--c-red`; hover shows stroke `rgba(229,55,46,0.6)` instead of white and cannot be selected |

### 9.3 Center readout
- Hovering a segment: name 16 / 600 `0.06em`, then description 13 / 400 `--c-text-dim`, max width 120, max 3 lines, centered.
  - APFSDS: "Kinetic dart. Fastest, flattest. Best vs armor."
  - HEAT: "Shaped charge. Good vs armor and light vehicles."
  - HE: "Blast and fragments. Infantry, soft targets, cover."
  - SMOKE: "Smoke screen at impact. Blocks line of sight."
  - Empty: description replaced by `NO ROUNDS` in `--c-red`.
- In dead zone: `KEEP` 11 / 600 `0.18em` `--c-text-dim` over current ammo name 16 / 600.

### 9.4 Input mapping (visual contract)
- While R held, mouse deltas accumulate into vector `v` (clamped to length 120 px of raw movement); aiming is frozen.
- `|v| < 36` = dead zone (no hover). Otherwise hovered segment = sector containing `atan2(v)`; gaps count toward the nearest segment.
- Release R: hovered + non-empty + not current -> select (starts reload per game rules); otherwise no change.
- Open: opacity 0 -> 1 and scale 0.94 -> 1, 110 ms `--ease-out`. Close: opacity to 0, 90 ms. Opening resets `v` to zero.
- Works in both third-person and optics.

---

## 10. Minimap (bottom-right)

### 10.1 Frame and scale
- Canvas 260 x 260, `right: var(--m); bottom: var(--m)`. Fill `--c-panel-strong`, border 1 px `rgba(255,255,255,0.18)`, radius 2. Content clipped to the square.
- Scale: 260 px = 400 m (0.65 px/m). Player always at center.
- **Rotation: rotating map, camera heading up.** Justification: the turret/camera turns independently of the hull, and a camera-up map keeps minimap left/right identical to screen left/right, which is what players of modern shooters expect. North indicator: `N` 11 / 600 `--c-text` in a 14 px dark circle orbiting at radius 118 from center (clamped inside the square), at the north bearing.
- Scale bar: bottom-left inside, 8 px inset: 65 px line (= 100 m) with 4 px end ticks, `--c-text-dim`, label `100 m` 10 / 500 above it.

### 10.2 Static layer
Render once at world build into an offscreen canvas covering world bounds at 2 px per m (cap 4096 px side); per frame draw it with translate(center) * rotate(-cameraYaw) * translate(-playerXZ * scale).
- Terrain base: transparent (panel fill shows through).
- Grid every 100 m: 1 px `rgba(255,255,255,0.05)` (reference shows a faint grid).
- Forest / tree clusters: `rgba(110,140,100,0.22)` fill.
- Water: `rgba(60,110,150,0.45)` fill.
- Roads: stroke `rgba(225,228,232,0.32)`, width = real width * scale, min 2 px, round joins.
- Buildings: fill `rgba(205,210,215,0.30)`, stroke 1 px `rgba(205,210,215,0.45)`.

### 10.3 Dynamic layer (drawn each frame in map space, symbols kept screen-upright)
- **Route**: polyline through remaining waypoints starting from player position: under-stroke 5 px `--c-blue-outline`, stroke 3 px `--c-blue`, round caps/joins. Waypoints: 7 px blue diamonds.
- **Objective**: 12 px diamond `--c-blue`, 1 px white outline. Current objective pulses: ring radius 6 -> 16, opacity 0.6 -> 0, 1200 ms, every 2000 ms. Outside the map: clamp to 10 px inset from edge, draw at full size plus a 5 px chevron pointing outward.
- **Enemies**: only while spotted: 9 px diamond `--c-red`, 1 px `rgba(0,0,0,0.5)` outline. On first spot: ping ring `--c-red` radius 4 -> 18, opacity 0.8 -> 0, 600 ms. Lost contact: hollow red diamond (1.5 px stroke) at last known position for 5 s, then fade 600 ms. Never shown unspotted.
- **Friendlies** (if any): 8 px circle `--c-blue`.
- **Player** (top of stack, center):
  - View cone: wedge from center, radius 70, angle = camera horizontal fov, fill `rgba(255,255,255,0.06)`. Always points up (camera-up map).
  - Hull: white chevron 14 x 16 (`M0,-8 L7,8 L0,4 L-7,8 Z`), rotated by hull yaw relative to camera yaw, 1 px `rgba(0,0,0,0.6)` outline.
  - Turret: 1.5 px line from center, 22 px long, `--c-text` at 0.8, rotated by turret world yaw relative to camera yaw.
- No text labels on the map.

---

## 11. Hit markers and damage direction (`#fx-canvas`)

### 11.1 Outgoing hit marker (our shell hits something)
- Centered on screen center (both views). 4 diagonal strokes at 45/135/225/315 deg, each from radius 10 to 18, width 2.
- Color by result: hit / non-penetration `--c-text`; penetration `--c-text` width 2.5 with strokes radius 10 -> 22; kill `--c-red`, width 3, radius 10 -> 24.
- Timing: grow from 70 % length over 80 ms `--ease-out`, hold 200 ms, fade 250 ms. Kill: hold 500 ms.
- Result text 13 / 600 `0.16em` at center + 44 px below: `HIT`, `NO PENETRATION` (`--c-text-dim`), `PENETRATION`, `TARGET DESTROYED` (`--c-red`). In 120 ms, hold 1000 ms, out 300 ms. Newest replaces older.

### 11.2 Incoming damage direction
- Arc on a circle of radius 180 around screen center, 50 deg span, centered on bearing from player to source relative to camera yaw (0 = top).
- Penetrating hit: stroke 6 px `--c-red`; ends fade (draw as 10 sub-segments, alpha ramping 0 -> 0.85 -> 0). Plus full-screen edge flash `radial-gradient(ellipse, transparent 55%, rgba(229,55,46,0.25))` 0 -> 1 -> 0 over 200 ms.
- Non-penetrating hit: stroke 3 px `--c-text` at 0.7, no flash.
- Timing: appear instantly, hold 300 ms, fade 1300 ms `--ease-out`. Max 4 concurrent; same-source hits within 500 ms refresh instead of stacking.

---

## 12. Enemy spotted marker (`#fx-canvas`, world-anchored)

- Position: enemy root + 2.2 m up (or above turret roof if a bone exists), projected each frame. Hidden if behind camera; no edge arrows (minimap/compass cover off-screen).
- Shape: diamond 12 px tall (square 8.5 px rotated 45 deg), fill `--c-red` at 0.95, 1 px `rgba(0,0,0,0.5)` outline. Constant screen size.
- Distance label (third person only): `740 m` 12 / 500 `--c-text` at 0.8, centered 10 px below diamond. Hidden under 50 m.
- Spot onset: scale 1.8 -> 1.0, opacity 0 -> 1, 220 ms `--ease-back`.
- Contact lost: diamond becomes hollow (1.5 px stroke) frozen at last known world position, 5 s, then fades 600 ms.
- Destroyed target: marker removed after the kill hit marker finishes.

---

## 13. Text shadow and legibility rules (all elements)
- Free-floating text and icons: `--shadow-text`. Text inside tiles/panels: lighter `0 1px 1px rgba(0,0,0,0.5)`.
- No glows, no gradients on text, no outlines on tiles beyond 1 px.
- Minimum rendered size: 10 px@1080 (only scale bar and LOADED tag).

---

## 14. Click-to-play / pause overlay

- `#overlay`: full screen, `background: var(--c-dim-screen); backdrop-filter: blur(4px);`, flex column centered. Fade 250 ms.
- Content block, width 560, centered text:
  1. Title: game title (placeholder `TANK COMBAT`), 40 / 600 `0.20em` uppercase. In pause: `PAUSED`.
  2. 1 px rule 64 wide `--c-text-dim`, margin 16 auto 20.
  3. Call to action: `CLICK TO PLAY` / `CLICK TO RESUME`, 18 / 600 `0.18em`, opacity pulse 0.6 <-> 1.0, 1600 ms `--ease-inout`. The whole overlay is the click target.
     - After pointer-lock exit, browsers reject re-lock for ~1 s: show CTA at `--c-text-off` without pulse for 1000 ms, then enable.
  4. Controls list, margin-top 36: two-column grid (key column right-aligned, width 45 %; action left-aligned), row height 30, gap 16 px between columns. Key caps: inline-flex, min-width 28, height 24, padding 0 6, border 1 px `rgba(255,255,255,0.40)`, radius 3, 13 / 600, background `rgba(255,255,255,0.06)`; multiple caps gap 4. Action text 15 / 400 `--c-text-dim`.
- Default rows (must mirror the actual bindings in the input code; the input code is the source of truth):
  - `W` `S`  Throttle / reverse
  - `A` `D`  Steer hull
  - `Mouse`  Aim turret
  - `LMB`  Fire
  - `RMB`  Gunner sight
  - `Wheel`  Sight zoom
  - `1`-`4`  Select ammo
  - `R` (hold)  Ammo menu
  - `Esc`  Pause
- Footer (pause only): `Mission time 04:12` 13 / 500 `--c-text-dim`, margin-top 28.

---

## 15. End screens

Shared layout: same overlay backdrop as §14 but `backdrop-filter` none; pointer lock released; content block width 560 centered at 44 % height.
1. Label 13 / 600 `0.24em` `--c-text-dim`: `MISSION` / `VEHICLE`.
2. Headline 48 / 600 `0.18em` uppercase.
3. Rule 80 x 2 colored per screen, margin 18 auto 24.
4. Stats table (width 320, centered): rows 30 tall, label 15 / 400 `--c-text-dim` left, value 15 / 500 tabular right: `Time`, `Shots fired`, `Hits`, `Enemies destroyed`, `Objectives` (`3/4`).
5. Button `RESTART`, margin-top 32: 240 x 48, border 1 px `rgba(255,255,255,0.5)`, fill `rgba(255,255,255,0.06)`, 16 / 600 `0.16em`; hover fill `0.16`, border `0.9`, 120 ms. Hint below: `Enter` key cap + `to restart` 13 / 400 `--c-text-dim`.

**Mission complete**
- Headline `MISSION COMPLETE` in `--c-text`, rule `--c-blue`.
- Sequence: 0 ms HUD fades out 400 ms; 600 ms backdrop fades in 600 ms; 900 ms content rises `translateY(12px -> 0)` + fades in 400 ms `--ease-out`; stats rows stagger 60 ms each.

**Tank destroyed**
- Headline `TANK DESTROYED` in `--c-text`, label `VEHICLE`, rule `--c-red`.
- Sequence: 0 ms WebGL canvas CSS `filter: grayscale(0.75) brightness(0.65) contrast(1.1)` transitions over 1500 ms `--ease-out`; red edge vignette `rgba(229,55,46,0.22)` fades in 300 ms then settles to 0.12; HUD fades out 400 ms. 1400 ms backdrop (opacity 0.5 of `--c-dim-screen`) + content as above.
- On restart: remove canvas filter instantly.

---

## 16. Thermal view (optional, P2 or skip)
Not required. If added: implemented as a post-process shader (not CSS). HUD changes only: reticle color switches to `rgba(255,255,255,0.85)` with dark halo `rgba(0,0,0,0.3)`; add `WHT` mode tag 13 / 600 `0.16em` to the left of the magnification text, 16 px gap. Everything else unchanged.

---

## 17. Implementation checklist (acceptance at a glance)
- [ ] All sizes go through `--u` / `u`; HUD looks identical in proportion at 1280x720, 1920x1080, 2560x1440.
- [ ] No HUD text jitters while values change (tabular nums + min-width).
- [ ] Only white, amber, red, blue (+ transient green check) appear.
- [ ] Optics reticle mrad scale follows actual camera fov; ticks move during zoom tween.
- [ ] Gun circle visibly lags aim point while turret traverses; loading arc and slot progress agree.
- [ ] Enemies appear on minimap/compass/screen only while spotted.
- [ ] Pause overlay appears on pointer-lock loss; CTA disabled for 1 s after exit.
