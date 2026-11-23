# Playable engine classes: design spec

Goal: the player picks which engine to pilot at the start screen: Kestrel, Harrow, Hierarch or great colossus.
Every class keeps the same control language:
- WASD is aim-relative and the legs follow travel. The mouse turns the torso and drags the legs past the waist limit.
- LMB/RMB are the arm weapons, Q is the carapace/secondary system, and E is the class's heavy ability.
- Shift is the class's movement burst.

The Kestrel stays exactly as it is now.

## Start screen
- Four cards on the overlay, keys 1-4 or click. Each card shows the class name, a one-line role and a scale silhouette (CSS, no 3D).
- The default selection is the Kestrel. Clicking a card starts the game, which keeps the existing pointer-lock and fullscreen path.
- URL override `?class=kestrel|harrow|hierarch|colossus` for testing and shots.
- On death, the respawn screen offers the same four choices.

## Battlefield bookkeeping
- When the player takes a class, the AI unit the player displaces is removed from the Vigil roster for that life, so the side doesn't get an extra engine:
  - Harrow: THE PENITENT BLADE.
  - Hierarch: SAINT ORVANE'S FIST.
  - Colossus: KARNAK THE PATIENT.
- The player is then named after that unit on the HUD.
- A Kestrel player leaves VIGILANT THORN (the allied AI scout) in place.
- Enemy AI keeps its existing target weights and treats the player as the unit they now pilot, using the AI weight for that unit type. Enemy great colossi will now duel a colossus-class player as their top target. The Synod-only "hunts the player" range rules still apply.

## Per-class handling
| | Kestrel (current) | Harrow | Hierarch | Great colossus |
|---|---|---|---|---|
| Top / burst speed m/s | 29 / 45 sprint | 16 / 24 charge (Shift, 3 s, coolant) | 11 / none | 6 / none |
| Accel / brake | current | 9 / 14 | 5 / 8 | 2 / 3 |
| Leg turn rate rad/s | 3.7 | 1.6 | 0.9 | 0.35 |
| Waist twist limit | current | 1.9 | 1.6 | 1.3 |
| Aim slew limit (rad/s) | none | 3.5 | 1.8 | 0.9, so the mouse leads and the torso lags behind it |
| Hull / shield | current | 950 / 350 | 1300 / 500 | 2400 / 900 (COL_HP / COL_SHIELD) |
| Camera pivot / distance | current (18 / 41) | 30 / 62 | 46 / 95 | 80 / 170 |
| Footstep trauma | current | ×1.8 | ×2.6 | ×3.5, plus a dust ring and nearby infantry knocked down |

- Brace/skid cornering applies only to the Kestrel and the Harrow.
- Hierarch and colossus turns are slow, ponderous pivots with no skid.
- Ram-through: the Harrow charge demolishes small and medium buildings. The Hierarch walks through small ones. The colossus walks through everything except hero spires and crushes tanks and infantry underfoot.

## Per-class weapons
Damage numbers reuse the AI specs so the balance stays symmetrical.
- **Harrow** (harrow-spec.md):
  - LMB: siege fist. 0.7 s wind-up, a 24 m arc, demolishes buildings; it hits whatever is in the arc on release.
  - RMB: lascannon. 0.6 s charge, instant 260 m beam, 4.5 s cooldown.
  - Q: rocket barrage on the crosshair ground point, 8 rockets, 10 s cooldown.
  - E: none.
- **Hierarch** (battle-colossus-spec.md):
  - LMB: rotary macro-cannon, held fire with spin-up and overheat.
  - RMB: fusion blaster. 1.2 s charge, slow heavy bolt, 6 s cooldown.
  - Q: missile pod, 6-missile volley, locks on to aircraft under the crosshair like the AA rack.
  - E: none.
- **Great colossus**, using the existing AI weapon set in colossus.js:
  - LMB: the main arm cannon or gatling battery the AI uses, aimed at the crosshair.
  - RMB: the charged lance (`fireLance`), with the existing charge tell, cooldown rr(8,14) and the spotlight as the aim indicator.
  - Q: the carapace battery as a barrage on the crosshair.
  - E: none.
  - Anything small within 40 m of a foot is stomp-damaged as the AI rules already do.
- Every non-Kestrel class gets no Sunspear (that is the Kestrel's trick) and no AA rack.
- Damage the player deals uses `byPlayer = true`, so the existing friendly-fire and grudge rules apply.

## HUD
- Engine integrity and armament panels relabel per class (weapon names and readiness bars).
- The legs PiP keeps working, but only fades in for the Kestrel and the Harrow (heavier classes barely twist).
- The auspex range scales with the class: 300 m / 400 m / 500 m / 700 m.
- The threat warning text switches to the heavier threat the class faces (for the colossus: enemy colossus lance charges aimed at you).

## Implementation notes for the implementer
- Keep the Kestrel path untouched and add the class as data plus small branches.
  The likely shape is a `CLASS` table in player.js holding handling numbers, a rig builder, the weapon set and camera numbers. Each heavy class reuses its AI module's rig builder and weapon effects, so nothing is duplicated.
  Do not refactor the AI classes beyond exporting the rig and weapon helpers they already have.
- The colossus rig is far bigger than the city's narrow lanes. Collision for a colossus-class player is a 12 m radius that only blocks against hero spires and colossus-class units, and its walking demolishes everything else.
- The great colossus camera at 170 m will clip buildings constantly. Its camera skips the building collision rays and relies on height instead.

## Shots
`?class=<name>&shot=pilot`: a third-person view of each class, piloted, mid-fight.
