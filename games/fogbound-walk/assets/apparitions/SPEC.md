# Apparition billboards (A1, RUN-20261119-03)

Painted replacements for `womanTex`, `creatureTex` and `figureTex`. Straight-alpha sRGB PNGs for the existing
unlit, fogged, `transparent`, `depthWrite: false` planes. Regenerate with `python paint_apparitions.py`
(numpy + Pillow, seeded, byte-identical output). Load as `SRGBColorSpace`, clamp wrap, mipmaps on.

Rules for all three: alpha is zero at every plane edge (except the woman's bottom edge, hidden by the window
frame), so a quad never shows. Edges dissolve; there is no outline or rim. Do not add one in code. Values match
the old procedural textures (near-black bodies, skin about 150-176), so opacity and fog settings carry over.
"Cover side" = the side painted to be hidden behind scenery. Mirror with `scale.x = -1` for the other side.

## 1. Window woman (keep; refined only)

| file | px | plane | use |
| --- | --- | --- | --- |
| `woman_far.png` | 320x512 | 0.62 x 0.99 m (unchanged) | stage 0 |
| `woman_near.png` | 320x512 | same | stage 1: head tilted and lowered, eye a little wider, fingers on the pane |

- Same composition, halo, palette and framing as `womanTex`; keep the existing stage transforms
  (`s/dy/rz/op`) and swap the map on `change()`. Pivot: plane centre at `anchor.interior`, as now.
- Hair is fine locks with gaps; the face shows only as pale slivers. One eye (viewer's right) sits in an
  almond-shaped parting with a glint; the other is a faint glint through the hair. Eye UVs (u, v from top):
  far 0.579, 0.390 and 0.447, 0.386; near 0.609, 0.408 and 0.477, 0.399.
- Near stage: pale hand lower left (UV 0.14-0.33, 0.62-0.84), fingertip pads brightest; it clears the mullion.
- Must not change: she stays a woman (closed mouth, no distortion), stays behind curtain and rain glass.

## 2. Forest beast

| file | px | plane | pivot |
| --- | --- | --- | --- |
| `beast_body.png` | 512x1024 | 1.30 x 2.60 m | bottom edge on the ground, `position.y = 1.30` |
| `beast_hand.png` | 256x256 | 0.50 x 0.50 m | centre; optional layer |

- Concept: something tall and thin crouched behind the stone. A long skull hangs out past the stone edge on a
  thin neck, cocked 12 degrees; one jointed foreleg is planted on the ground on spider-like fingers, a fainter
  second leg behind it; the arched back is behind and above the stone and goes to smoke. No torso is shown.
- Cover side: LEFT (u = 0). Place the plane behind the stone (farther from the camera, depth-tested) so the
  stone's edge covers the left 0.20-0.25 m. The far left 0.05 m fades out, so a misfit shows haze, not a cut.
- Eyes: keep the procedural `eyesTex` and its morph unchanged (approved). Re-seat the eyes plane on the skull:
  centre at UV (0.569, 0.346) = x +0.09 m from the body plane's centre, y 1.70 m; `rotation.z = -0.21` rad
  (clockwise). Eye centres land at UV (0.411, 0.329) and (0.727, 0.363). When mirrored: x -0.09, rotation +0.21.
- `beast_hand.png`: four long dark fingers hooked round the stone. Its RIGHT edge (u = 1) is the stone's
  silhouette edge on the beast's side; fingers reach left across the lit face. Put it just in front of the
  stone surface, centre about 1.25 m up, mirrored together with the body. Dark on the lantern-lit stone is the
  strongest read of the set; drop it for covers where it cannot sit on a surface (foliage).
- A faint warm rim on the right (lantern) side is painted in; it suits the clearing stone and is negligible elsewhere.

## 3. Manor: the tall one (one entity, two poses)

| file | px | plane | pivot |
| --- | --- | --- | --- |
| `figure_lean.png` | 512x1024 | 1.40 x 2.80 m | bottom edge on the floor, `position.y = 1.40` |
| `figure_stand.png` | 512x1024 | 1.40 x 2.80 m | same |
| `figure_hand.png` | 256x256 | 0.40 x 0.40 m | centre; doorway layer |

- `figure_lean` (doorway, first sighting): leaning out from behind the jamb far too high. A head lying on its
  side at 2.35 m with a pale smear for a face, hair hanging straight down from it, and one arm hanging to shin
  height (fingertips 0.25 m off the floor). Amber rim from the hall lamp behind it.
  Cover side: LEFT. In the door frame (`at(DS)`: x right, z toward the court) put the plane parallel to the
  facade at z about -0.65 (just inside the wall), its left edge at x = -1.55, i.e. centre x = -0.85, so the jamb
  and frame post (inner edge x = -1.40) hide the left 0.15 m. Better not billboarded here; if it is, keep the
  left edge behind the jamb. Head centre UV (0.275, 0.159).
- `figure_hand.png`: four long pale fingers round the frame post. RIGHT edge (u = 1) on the post's inner edge
  (x = -1.40), plane on the post's front face (z about +0.27), centre x = -1.60, y = 2.0 m.
- `figure_stand` (corridor; also the doorway's "closer" stage): too tall for the ceiling, so the neck folds and
  the head lies over above one shoulder (head centre UV (0.661, 0.079), 2.58 m). Narrow shroud whose hem is in
  strips and gone before the floor; arms hang to 0.3 m with pale hands. Shoulders and chest folds catch the
  ceiling lamp; the lower half sinks into the dark. Figure is centred in the plane; billboard as now.
  Suggested doorway `change()`: hide lean + hand, show stand centred in the opening (with or without the step).
- If the stand pose looks too lit when backlit in the doorway, set `material.color` to about `0x9098a8` there.
- Must not change: no face features, no extra limbs, no red; it stays thin, tall and mostly dark.

## Legibility target

Checked at 60 / 120 / 200 px plane height over fog `#1a2430` and in mock-ups of each site
(`a1_contact.png`). At range each reads as one shape: pale slivers in dark hair; eyes plus fingers on the lit
stone; a sideways head with hanging hair at the jamb; a too-tall column with low pale hands.
