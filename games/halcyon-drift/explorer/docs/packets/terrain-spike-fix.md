# Packet: band-limit Kestrel (and Aethel) terrain to stop noise-needle aliasing

**Status:** ready, not started.
**Owner lane:** implementer (Sonnet).
**Scope:** `explorer/src/terrain/` only.

## Problem
Kestrel's highlands render as a field of thin vertical spikes ("noise needles") from altitude and at mid-distance (see
`explorer/shots/21b_landing_site.png`).
- **Cause:** the height function adds high-frequency ridged noise that a coarse distant chunk cannot resolve at its grid
  spacing, so it aliases into needles.
- **Same bug on Verdant, already fixed:** Verdant had the same bug and it was fixed by band-limiting.
- **Other worlds:** Pyra, Nyth and Glaciera already carry the same fix.
- **Kestrel:** it never got it.

## Existing mechanism (reuse, do not redesign)
- **Worker call:** `terrain/worker.js:12` calls `rc.setBand(step > 6 ? step : 0)` before building a chunk, and
  `rc.setBand(0)` afterwards (line 65). Physics and scatter on the main thread therefore always see full detail
  (`BAND = 0`).
- **Recipe side:** each recipe exports `setBand(step) { BAND = step * 4.5; }`. It then fades out every octave whose
  wavelength is below `BAND` (see `terrain/verdant.js` around line 74, `pyra.js:112`, `nyth.js:103` and `glaciera.js:36`).
  A smoothstep fade on each octave stops pops at LOD boundaries.

## Change
1. **`terrain/kestrel.js`:** add `let BAND = 0; export function setBand(step) { BAND = step * 4.5; }`. In the ridged and
   fbm octave loops of the height function, scale each octave's amplitude by
   `1 - smoothstep(0.5 * BAND, BAND, wavelength)`, the same pattern as Verdant. Leave all `BAND = 0` output
   bit-identical, so physics, landing-site search, scatter and the bike are unchanged.
2. **Aethel:**
   - Check `terrain/aethel.js` (shell) and `terrain/aethelin.js` (interior) for the same high-frequency terms.
   - If they alias at distance, apply the same treatment.
   - If they don't, leave them alone and say so.
3. **Normals and material masks:** if Kestrel's `materialAt`/normal sampling uses the same noise, band-limit it in step
   so that distant shading matches the smoothed geometry.

## Acceptance
- **Visuals:** from about 1.5 km AGL over the Kestrel highlands (the 21b landing-site view), ridges read as eroded
  ranges, with no needle field. Near ground still shows full detail.
- **Physics unchanged:** the height function with `BAND = 0` returns identical values. Spot-check about 20 points
  before and after.
- **No regressions:**
  - No visible LOD seams or popping when flying over at 200 m/s.
  - Clean console, fps unchanged (about 60).

## Verification (cheap only)
- **Shots:** before and after `22_kestrel_highlands_1500m.png` from the same camera, plus one low-altitude shot. Reuse
  the existing headless shot scripts and `window.__game` teleport hooks.
- **Out of scope:** no new test harness and no other worlds' look.
