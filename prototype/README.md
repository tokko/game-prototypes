# Halcyon Drift: orbital prototype

A chill patched-conics flight prototype (three.js r160, no build step).
Fly the carrier from low Halcyon orbit to the moon Pell, undock the lander, land on a marked ore site,
drill and refine propellant, lift off and dock again. A second, much smaller moon, Wren, orbits farther out
(same assists work there, objectives stay Pell-specific). Maneuver nodes and targeted planners are described below.

## Run

```
cd prototype
python -m http.server 8000
```

Open http://localhost:8000/ in a desktop browser with WebGL2. three.js is loaded from the jsDelivr CDN
(pinned `three@0.160.0`, importmap in `index.html`), so you need an internet connection on first load.

## Controls

| Input | Action |
| --- | --- |
| W / S, A / D, Q / E | pitch, yaw, roll |
| Shift / Ctrl (or Up / Down arrows) | throttle up / down (browsers grab Ctrl+W, so the arrows are the safe pair) |
| Z / X | full throttle / cut |
| T | SAS on/off |
| 1-9, 0 | SAS mode: stability, prograde, retrograde, normal, anti-normal, radial out, radial in, target, anti-target, maneuver (burn vector of the first node) |
| `,` / `.` | time warp down / up (1, 2, 5, 10, 50, 100, 1000, 10000, 100000x; 100x max while thrusting) |
| `[` / `]` | switch vessel |
| M | map view (Tab cycles focus: vessel / Halcyon / Pell / Wren) |
| Mouse drag / wheel | orbit camera / zoom (flight and map) |
| U | undock lander (saves a revert point) |
| H | transfer assist (any vessel in Halcyon orbit): plans a node to the target body and executes it |
| C | circularize at next apsis |
| L | landing assist (lander, at Pell or Wren: the selected ore site of that moon, else the nearest-wait beacon; suicide burn) |
| B | ascent assist (lander, Pell or Wren; times launch to meet the carrier's orbit, then circularizes) |
| V | rendezvous assist (needs the other vessel within 150 km) |
| G / R | drill (landed inside a blue beacon ring) / refine ore (lander or carrier, landed or in orbit) |
| F | rover drive mode (lander landed with the wheels down): W/S drive, A/D steer, Space brake. Lift-off exits it. |
| Y / I | docked: pump propellant carrier -> lander / offload ore lander -> carrier |
| J / K / N (act on the vessel you are flying: press `]` to switch to the lander after undocking) | extend/retract solar panels / radiators / landing gear (also the buttons in the vehicle panel) |
| O | toggle auto-retract of panels and radiators during burns over 1.5 g (default on) |
| `;` / `'` | add a maneuver node at the next apoapsis / periapsis (2 minutes ahead if the orbit is circular) |
| `=` / `-` | node prograde / retrograde by the step size |
| Home / End | node normal / anti-normal |
| PageUp / PageDown | node radial out / radial in |
| Left / Right | move the node earlier / later along the orbit (step scales with the period) |
| `\` | cycle the node step: 0.1 / 1 / 10 / 100 m/s |
| Enter | execute the node (warps to half the burn before it, burns, removes it) |
| Delete | delete the node |
| `` ` `` / `/` | cycle the target body (Pell / Wren) / the target ore site on it (none = automatic) |
| Backspace | cancel assist |
| F5 / F9 | quicksave / quickload |
| P | pause |
| F1 | help overlay |

The Maneuver panel (right, under the flight data) shows the target body and site, the first node (time, dv and its
prograde/normal/radial parts, estimated burn time, orbit or encounter after the node) and has buttons for Plan xfer
(transfer node to the target moon: periapsis target 55 km at Pell, 15 km at Wren), Circ Ap / Circ Pe (circularization
nodes), Exec and Del. C still circularizes immediately. The map draws the post-node trajectory in magenta with a node
marker, its Ap/Pe, and the encounter. Warp is capped before an unexecuted node's burn.

Auto-dock: within 50 m and under 2 m/s relative speed. Crash: impact over 5 m/s, more than 3.5 m/s sideways,
or touching down more than 25 degrees off vertical. The crash screen offers quickload, "revert to before undock"
and restart.

## Layout

- `src/orbits.js` Kepler elements, analytic propagation, conic sampling (elliptic and hyperbolic).
- `src/bodies.js` planet, moons (Pell, Wren), SOI radii, ore sites (plain data; hooks for survey/outposts/contracts).
- `src/vessels.js` vessel data model, engines, fixed fuel:oxidizer mixture, attitude control.
- `src/world.js` universal time, on-rails vs numeric stepping, SOI transitions, contact/crash, docking, objectives, prediction, save/load.
- `src/autopilot.js` circularize, node execution, transfer/circularize node planners, landing, ascent, rendezvous assists.
- `src/models.js`, `src/sky.js` procedural ships, skybox, planet/atmosphere, cratered moon, beacons.
- `src/map.js`, `src/hud.js`, `src/input.js`, `src/main.js` map overlay, HUD + navball, controls, render loop.

## Tests

```
cd prototype/test
npm install
node --import ./register.mjs t4.mjs   # headless full-loop sim, prints PASS
node overlap.mjs                      # HUD overlap check (needs a static server on :8777 and local Chrome)
```
