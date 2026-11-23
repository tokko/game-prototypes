# Princeps play: orders, Wrath and fewer, nastier heavies: design spec

The problem: heavy play is a slog. Find the largest enemy, unload into it, repeat. Allies are background noise, and commanding them must not turn the game into a slow RTS.

The goal: the player is a princeps, not an RTS player.
- Intent is given from the cockpit with one keypress at the crosshair. Competent named subordinates carry it out.
- Smashing the small stuff fuels god-machine powers.
- Enemy heavies are few, have plans, and can be beaten by maiming as well as by killing.

Approved by the user: 1) crosshair orders, 2) a Wrath economy, 4) fewer, nastier heavies. The push-your-luck reactor was not chosen; don't add it.

Applies to player-piloted heavies (Harrow, Hierarch, Colossus). The Kestrel class is unchanged: no orders, no Wrath, and its controls stay identical.

Build order: 4, 1, 2. Fewer heavies first, because it changes what orders and Wrath act on.

## 4. Fewer, nastier heavies

### Roster
- Each side fields exactly one colossus, one Hierarch and one Harrow, plus its Kestrels, tanks and infantry.
- Measure the current counts first. Remove the extras by taking them out of the spawn list, without restructuring the classes.
- The player's displaced unit is still removed from the Vigil roster, as now.

### Heavy respawn
- Colossus 150 s, Hierarch 110 s, Harrow 80 s.
- A heavy kill now swings the front for a while.

### Battle plans
The objective director (`js/objectives.js`) gives every enemy (Synod) heavy one plan. It re-evaluates every 20 s, or when the heavy's current plan becomes impossible.

| Plan | Behaviour |
|---|---|
| HUNTER | Goes after the player's engine. It approaches with Synod Kestrels flanking toward the player's weakest facing, and it ignores sites. At most one heavy has this plan at a time. |
| BREACHER | Pushes the Vigil-owned site nearest the Synod side, preferring the gate E. It fights whatever contests it there. |
| SIEGE | Holds C or the Synod-leaning anchor, and shells from range (battery, missiles, artillery zone). |

- Assignment:
  - The colossus prefers SIEGE.
  - The Hierarch prefers BREACHER.
  - The Harrow prefers HUNTER when the player is a heavy.
  - The director may swap plans by situation, for example a BREACHER whose target site is already Synod becomes SIEGE.
- Allied (Vigil) AI heavies keep the existing director behaviour, except when given an order (section 1).
- Announce plans when they are assigned or changed:
  - "ASHTONGUE HUNTS YOU"
  - "CINDERMAW MARCHES ON GATE E"
  - "THE SYNOD COLOSSUS DIGS IN AT C"
- The enemy heavy's auspex glyph gets a small plan letter: H, B or S.

### Crippling
- **LEGS component destroyed:** the engine is CRIPPLED.
  - Speed ×0.25. This replaces the old ×0.5.
  - Capture weight 0. It also cannot contest: it doesn't freeze capture.
  - The director withdraws it toward its own bastion. It can still fire.
  - After reaching its bastion zone, or after 60 s, it repairs LEGS to 40% over 30 s and returns to duty.
- **Both arm components destroyed:** the engine is DISARMED and withdraws the same way, regaining one arm at 40% after 45 s.
- Crippled and disarmed engines show a status word on their HUD bar and auspex glyph.
- Announcements: "CINDERMAW CRIPPLED - WITHDRAWING".
- The same rules apply to the player:
  - Crippled player legs mean speed ×0.25, with LEGS self-repairing to 40% after 45 s of not taking leg damage.
  - A disarmed player regains one arm the same way.

## 1. Crosshair orders (heavy classes only)

### Groups
The player's allies form four groups. They are named on the HUD with their unit names where they have them.

| Group | Members |
|---|---|
| WING | allied AI Kestrels (VIGILANT THORN and any others) |
| LANCE | allied AI heavies not displaced by the player |
| ARMOUR | the two Vigil tank lane groups nearest the order point, plus gate reserves |
| COHORT | the three Vigil infantry squads nearest the order point |

### Keys
- Defaults are below. If a key is already bound, take the nearest free key and report it.
- **F: context order at the crosshair.** It also works in the Tab tactical view at the virtual cursor. What it does depends on what's under the crosshair:
  - **An enemy heavy: KILL THAT.** LANCE engages it from a bearing at least 60° off the player's line (reuse the existing ally flank logic), and WING harasses its weakest facing.
  - **An enemy small unit, a cluster or enemy ground: CLEAR THAT.** ARMOUR and COHORT advance and engage there, and WING sweeps it.
  - **An objective site: TAKE THAT** (or HOLD THAT if it is already Vigil). ARMOUR and COHORT go to the ring. LANCE also goes if an enemy heavy is in or near the ring.
- **Hold 1, 2, 3 or 4 while pressing F** to send the order to one group only (WING, LANCE, ARMOUR, COHORT), overriding the automatic group choice.
- **R: ON ME.** LANCE and ARMOUR form up within 80-150 m of the player and follow. WING screens the player's rear arc. COHORT holds its current position.
- **V: stand down.** All groups clear their orders and return to the director.

### Order rules
- Each group has at most one order, and a new order replaces it.
- Ordered units still fight targets of opportunity on the way, using the existing targeting, but prioritise the order.
- Orders end when:
  - KILL: the target dies, becomes crippled, or leaves 900 m.
  - CLEAR: no enemies within 60 m of the point for 10 s.
  - TAKE: 60 s after capture. Holding then becomes the director's job.
  - ON ME: lasts until replaced or V.
- Any group without an order follows the objective director as now.

### Feedback
- Radio barks in the announcement or log area, one per order, from the group's lead:
  - "THORN: MOVING ON HIS FLANK"
  - "PENITENT BLADE: ENGAGING"
  - "ARMOUR: ROLLING ON B"
- Order markers: a small world marker plus an auspex and Tab glyph at the order point or target, in each group's colour, with lines from the group to it on the Tab map.
- A compact group panel shows the four groups, their current order and their strength (for example "LANCE 2/2").
- Orders never select or highlight individual units.

## 2. Wrath (heavy classes only)

A 0-100 meter. It belongs to the player only, and the AI does not use it.

### Gains
| Event | Wrath |
|---|---|
| Infantry kill | 0.5 (stomp kill 1) |
| Tank kill | 4 |
| Enemy Kestrel kill | 8 |
| Building destroyed | 3 (hero spire 10) |
| Collapsing an enemy heavy's facing | 6 |
| Destroying an enemy component | 10 |
| Crippling or disarming an enemy heavy | 15 |
| Heavy kill | 25 |
| Site captured with the player in the ring | 10 |

- Decay: none while gaining. After 15 s with no gains, it decays at 0.5 per second.

### Spending
Each power has its own key. A power cannot be used without enough Wrath.

**WAR HORN (E): 30 Wrath.**
- Range 250 m around the player.
- Enemy infantry rout: they flee and don't fire for 8 s.
- Enemy tanks' fire rate is halved for 6 s.
- Allied units deal +25% damage for 10 s.
- Visual: a ground shockwave ring and a low brass blare.

**OVERCHARGE (C): 50 Wrath.** For 10 s:
- energy weapons cost no capacitor;
- the lance charges in 1.2 s;
- the gatling, macro-cannon and other heat weapons don't overheat;
- the per-facing regen pause on your own ward is halved.
- Visual: the reactor glow brightens and arcs crawl over the hull.

**HEAVEN'S NAIL (X): 100 Wrath.**
- An orbital beam at the crosshair ground point, up to 600 m, after a 4 s telegraph (a pillar of light narrowing onto a ground ring).
- Radius 30 m:
  - kills all infantry and tanks;
  - levels non-hero buildings;
  - does S 600 / H 600 to heavies, split across their standing facings first, then hull, located at the impact.
- Friendly fire applies to allies inside it.

### HUD
- A vertical Wrath bar beside the capacitor bars, in gold rising to red, with notches at 30, 50 and 100 and power icons that light up when each power is affordable.
- The Tab view shows the Wrath bar too, and Heaven's Nail can be aimed at the virtual cursor.

## Tuning targets (measure and report; retune these numbers in place)
- A colossus life of normal play (stomping and fighting toward a site) earns a WAR HORN in about 30-45 s, and HEAVEN'S NAIL in about 3-4 minutes.
- With one heavy per class per side, an AI-only match (no player) still flips at least one site within 5 game-minutes.
- With the player as a colossus giving reasonable orders, one side should be able to reach the bastion within 15 minutes. Report one run if it is cheap; otherwise say so.

## Implementation notes
- Smallest change within the existing modules. Orders and Wrath live where the player and objectives code already lives (player.js, objectives.js and main.js); a small new module is fine if it keeps main.js readable.
- Reuse the existing fx, tracer, announcement, auspex and Tab paths. Visuals are simple and functional in the existing style: rings, markers, a bar and a shockwave. No designer pass is planned.
- Keep the Kestrel paths and controls unchanged.
- Bump every `?v=` uniformly.
- Update the controls help in index.html for heavies: F order, 1-4+F group order, R on me, V stand down, E horn, C overcharge, X Heaven's Nail.
- Shots:
  - `?shot=orders&class=colossus`: Tab view with three active orders, their markers, and the group panel.
  - `?shot=nail&class=colossus`: Heaven's Nail mid-telegraph near an enemy heavy, with the Wrath bar visible.
