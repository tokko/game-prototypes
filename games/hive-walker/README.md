# Hive Walker (three.js vertical slice)

A quick, playable prototype: you pilot a ~19 m war-walker of the Karnite Vigil through a
gothic-industrial hive district while 100 m colossi duel over your head. Original setting,
names and heraldry; no external assets (three.js from CDN only, all geometry, shaders and
audio are procedural).

## Run

    python -m http.server 8001 --directory L:\Work\ai_projects\hive-walker-web

Open http://localhost:8001/ and click to start (pointer lock + audio).

## Controls

| Input | Action |
| --- | --- |
| W / S | Legs: stride forward / back (heavy momentum). Holding W with no A/D swings the legs round to where the torso is aiming (4 degree deadzone), so W means "advance where I'm looking"; S never re-aligns |
| A / D | Legs: turn. At speed the walker braces, bleeds speed, skids and pivots; at a standstill it stomp-pivots |
| Shift (hold) | Sprint: 1.6x top speed, longer stride. Burns coolant (6 s, then locks until 35% refilled), narrows the twist range, widens gatling spread, and pauses veil recharge |
| Mouse | Torso twist and aim, independent of the legs (about +/-140 degrees) |
| LMB | Inferno projector: a 40 m arcing flame jet fed from a pressure tank (5.5 s of spray, refills in 5 s). Troopers it touches burn, run and die; their squad panics, scatters and stops shooting. Flame that lands leaves burning ground for 6-10 s that ignites anything crossing it and stops squads advancing through it. Tanks cook slowly; small hab-blocks catch fire and weaken |
| RMB | Autocannon arm: kills tanks, cracks buildings |
| E (hold 1.5 s) | Sunspear: back-mounted fusion projector, 78 m range, 20 s cooldown, heavy heat. Kills tanks, cracks buildings, and is the anti-colossus tool: a leg or rear hit ignores the shield, does bonus damage and staggers the engine for 14 s |
| Q (or F / middle mouse) | Anti-air rack: hold on an aircraft to lock, release to fire a 6-missile salvo |
| H | Toggle HUD |

When the legs and the aim differ by more than ~30 degrees a picture-in-picture view fades in
(top right) looking along the leg heading.

Ward veil: a rechargeable shield (blue bar above hull) that soaks about one fusion-lance class hit, two or three
tank shells, or a burst of small arms, then shatters. It starts recharging 4.5 s after the last hit and refills in
5.5 s. Colossus lances and feet go straight through it.

Hierarch-class battle colossi (model/hierarch.glb, spec model/battle-colossus-spec.md) hold the line between the scouts and the
colossi, one per side: 1300 hull behind a 500 ward, 11 m/s, fusion blaster (1.2 s charge, glowing barrel), macro-cannon, missile
pod. The Sunspear ignores their shield; leg or rear hits stagger them for 10 s. A colossus stomp lames their legs for 15 s.

Colossi have 2400 hull behind a 900-point shield that recharges after 18 s without damage. They smoke, burn, limp and
lose weapon arms as they are whittled down, and die in a reactor-critical topple that flattens what is under it.
Their bars are listed top left. Enemy colossi prioritise allied colossi; they only hunt you if you are within about
120 m, have hurt them in the last 12 s, or no allied colossus is left to fight, and never within 28 s of their last
hunt. Within 95 m their close-defence guns open up.

Buildings: sprinting into a low or medium hab-block (not a spire or cathedral-factory, body up to 46 m; 122 of the 352 qualify)
smashes straight through it for 35% of your speed and 5 hull. At a run or walk you push it over in 1-2 s. Bigger
buildings stop you but take the impact; the autocannon fells a hab in 5 shells and a spire in 7, the sunspear in one or two.

Friendly fire is total. Every weapon, blast, stomp, bomb, burning patch and collapsing building hurts whoever is under it,
your own side and you included. The reticle turns blue with "ALLY IN YOUR FIRE" when Vigil troops are in the flame cone
or at the aim point, the HUD tallies "ALLIED LOSSES TO YOU", and an allied colossus you keep shooting turns its guns on
you for 24 s.

Threats: enemy colossi (CINDERMAW, THE PYRE-FATHER) telegraph with a red searchlight and a HUD
countdown, then fire a lance. Break line of sight behind a building (it will be destroyed
instead of you). Any colossus foot, allied ones included, crushes you. Fusion-lance infantry
teams (orange, larger figures) cripple your legs: a damaged leg slows you and makes you limp.
The engine repairs itself after 9 s without damage.

## URL parameters

- `?shot=overview|gatling|duel|pip|aa|hunt|skid|lance|inferno` staged views used for the screenshots in `shots/`
- `?test=1` skips the start overlay and takes mouse input without pointer lock (automation)
- `?warm=N` seconds of battle simulated before the first frame (default 20)

## Layout

- `index.html` HUD and import map
- `js/main.js` renderer, sky, post, cameras + PiP, input, HUD, world hitscan/blast
- `js/city.js` procedural district, window/grime shader, collision, building collapse
- `js/player.js`, `js/legs.js` the walker, weapons, damage; shared procedural gait + IK
- `js/units.js` instanced infantry squads and tanks
- `js/colossus.js` the god-machines
- `js/air.js` fighters, gunships, bombers, AA missiles, artillery
- `js/fx.js` pooled particles, tracers, beams, flash lights, decals, debris
- `js/audio.js` procedural Web Audio
- `js/shots.js` screenshot presets
