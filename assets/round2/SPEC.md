# Round-2 apparition billboards (R2-art, RUN-20261119-03)

Eleven painted textures for five new apparitions. Straight-alpha sRGB PNGs for unlit, fogged, `transparent`,
`depthWrite: false` planes. Load as `SRGBColorSpace`, clamp wrap, mipmaps on. Regenerate with
`python paint_round2.py [name-prefix ...]` (numpy + Pillow, seeded, byte-identical; it imports the toolkit in
`../apparitions/paint_apparitions.py`).

Rules for all: these are PALE shapes meant for dark backgrounds (skin peaks about 190-215, cloth 130-175).
Alpha is zero on every border pixel, bottom edge included, so a quad never shows; edges dissolve, there is no
outline or rim, do not add one in code. If one glows too much in its spot, dim it with `material.color`
(about `0xa8b0bc`), not with opacity. Mirror with `scale.x = -1`. "u, v" = UV with v measured from the top.

| file | px | plane (m) | pivot |
| --- | --- | --- | --- |
| `angel_0.png` .. `angel_3.png` | 512x1024 | 0.9 x 2.0 | bottom edge on the ground, `position.y = 1.0` |
| `ceiling_woman.png` | 512x512 | 1.3 x 1.3 | centre; top-centre of the plane into the corner |
| `sob_back.png`, `sob_turn.png` | 512x512 | 1.0 x 1.0 | bottom edge on the floor, `position.y = 0.5` |
| `wraith.png` | 256x1024 | 0.8 x 2.6 | centre; may float 0.2-0.5 m off the ground |
| `crosser_run.png` | 512x576 | 1.6 x 1.8 (the tall option) | bottom edge on the ground, `position.y = 0.9` |
| `crosser_low.png` | 1024x256 | 1.8 x 0.45 | bottom edge on the ground, `position.y = 0.225` |
| `crosser_window.png` | 256x512 | 0.5 x 1.0 | centre, behind the pane |

`crosser_run` uses the packet's tall alternative (an upright runner reads as a person); nothing else differs.

## 1. The statue (`angel_0..3`)

- One entity: weathered pale stone that might be skin, about 1.9 m, narrow, long neck, plain gown to the
  ground, hair bound back. Rain marks and lichen; the lower half sinks into dark and ground mist.
- `angel_0` (far, first): square to the viewer, head bowed, face in both hands.
- `angel_1`: mid-stride toward +u, body side-on, arms swung, the head brought round to look back at the viewer.
- `angel_2`: square on, one arm held out toward the viewer's right, head lying over 50 degrees.
- `angel_3` (closest, last): bent forward, shoulders rolled, arms hanging, face half-turned, hollow eyes,
  mouth a little open. Head centre u 0.51, v 0.21.
- Baked light: cold, from the upper left front, identical in all four so a swap never makes the light jump.
  Mirror all four or none. Feet/hem are at the bottom edge in every pose; swap maps on one plane, no rescale.
- Use: only ever swapped while unseen; no tween, no fade between poses. Billboard yaw only.
- Must not change: no wings, no teeth, no red, no animation of the texture; it stays a statue.

## 2. The woman in the ceiling corner (`ceiling_woman`)

- Seen from below and in front: knees folded up above the shoulders, feet braced out on the two walls, elbows
  out, long hands hanging either side of the head, black hair straight down for 0.6 m, one open eye in a
  parting (u 0.52, v 0.47). The body fades up into the dark of the corner.
- Baked light: from below (the room lamp is under her). Image-down is world-down: tilt the plane about its
  horizontal axis to face the viewer, never roll it.
- Placement: top-centre of the plane at the corner apex; the hair needs clear air below it, and reads best
  with a lit wall or lamp haze behind (it is black). Do not billboard in roll; yaw toward the player is fine.
- Must not change: one eye only, mouth closed, hair vertical.

## 3. The sobbing woman (`sob_back`, `sob_turn`)

- Sitting on the floor with her back to the viewer in a pale slip: drawn-up shoulders, bare back with too
  much spine, black hair parted at the nape and down over the shoulder blades, one hand gripping her own arm.
- `sob_turn`: same body; the head has come right round over her shoulder (face centre u 0.55, v 0.28): eyes
  too large with too much white, a mouth much too wide. The face is the brightest thing in the frame.
- The two files are pixel-identical outside u 0.30-0.72, v 0.15-0.46 (verified), so a one-frame map swap moves
  only the head. Same plane, same transform; a tremble (jittering the plane 2-4 mm) suits `sob_back`.
- Baked light: soft, upper left front. A faint cold haze is painted behind her (window air).
- Must not change: no blood, no extra limbs; do not tween or cross-fade the swap.

## 4. The forest wraith (`wraith`)

- A thin drifting streak of pale haze with a hint of shoulders, a hollow face near the top (v 0.11; the face
  is only missing haze, not paint) and wisps let down from it. Peak alpha 0.55, most of it far lower.
- Keep it against dark trunks or undergrowth, never against the lamp or sky; additive blending is not needed.
  Slow drift and a little sway are fine; so is `scale.x = -1`. At 25 m it is nearly gone by design.

## 5. The crossers (`crosser_run`, `crosser_low`, `crosser_window`)

- All three are painted moving toward +u with the shutter smear and a short tail baked in; mirror the plane to
  go the other way and move it along its own u axis only. Do not billboard them toward the player mid-run.
- `crosser_run`: a thin pale figure loping, pitched forward, arms too long, dark hair blown back. Figure about
  1.55 m tall, leading hand at u 0.98, tail gone by u 0.10.
- `crosser_low`: something pale on all fours, belly to the floor, one knee and one elbow above its back.
- `crosser_window`: a pale face with three dark places (eyes, mouth) and shoulders, turned to look in as it
  goes past. Put it 0.1-0.3 m behind the glass; the frame should hide the plane's lower third.
- Meant for a few frames to under a second; held still they read as blurred photographs.

Legibility: checked at 30 / 60 / 100 px per metre over fog `#1a2430` and in site mock-ups (`r2_contact.png`).
