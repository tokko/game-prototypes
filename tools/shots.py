"""Prompt bible for the five plates. One fiction, three recurring ship designs, described verbatim in every shot."""

HEAD = "Photorealistic cinematic screenshot from a AAA space flight game, rendered in Unreal Engine 5 with ray tracing. "
TAIL = (" Realistic physically based materials, believable scale, hard directional sunlight with deep shadows, natural filmic color grading, "
        "restrained saturation, deep blacks, subtle lens bloom, extremely detailed, sharp focus. No text, no letters, no logos, no HUD, no interface.")

SKY = ("richly detailed deep space photographed like a long-exposure astrophotograph, with no empty black areas: a broad luminous emission nebula "
       "in violet, indigo and rose with teal filaments spreading across much of the sky, the dense star-filled band of the galaxy with dark dust lanes, "
       "and tight glittering star clusters")

CARRIER = ("The carrier is a 300-meter industrial mothership: a long slab-sided hull of white ceramic panels with graphite-grey machinery and "
           "burnt-orange stripes, a blocky command tower with an antenna mast, an exposed box-truss spine along its top, a large rectangular "
           "hangar bay open in its flank and lit warm amber inside, and four large engine nozzles at the stern.")
PLANE = ("The spaceplane is a sleek delta-wing shuttle: white upper hull with burnt-orange stripes on the wings, black heat-shield tiles on the "
         "underside, twin canted tail fins, dark cockpit windows and two engine nozzles.")
LANDER = ("The lander is a compact squat vehicle: an octagonal white and graphite-grey body with burnt-orange stripes, gold foil insulation around "
          "its lower stage, four splayed landing legs with round footpads, one central descent engine, a small dish antenna on top and bright landing lights.")
OCEAN = ("the ocean world Thalen: deep blue seas, green and tan continents, swirling white cloud systems and a thin glowing blue atmosphere at the limb")
GIANT = ("the ringed gas giant Oruun with cream and amber cloud bands and a broad tilted ring system")

SHOTS = {
    "01_approach": HEAD + (
        "A carrier spaceship approaches a habitable planet. " + CARRIER + " It flies away from the camera toward the planet, seen from behind and "
        "slightly above in the left half of the frame, its engines burning with blue-white exhaust. The right half of the frame is filled by " + OCEAN +
        ", its night side beyond the terminator sprinkled with faint golden city lights. A warm yellow-white sun flares at the upper left and rim-lights "
        "the ship. A small cratered moon hangs in the distance. Behind everything is " + SKY + ".") + TAIL,
    "02_atmosphere": HEAD + (
        "A spaceplane during atmospheric entry, high above a habitable planet. " + PLANE + " It flies level toward the distant horizon, seen from above and behind in a "
        "three-quarter view, right of center, with a thin glow of orange re-entry plasma along its nose and wing leading edges and faint incandescent "
        "streaks trailing from its wingtips. Far below lie sunlit cloud decks, a rugged coastline, mountain ranges and turquoise sea, with the low "
        "golden sun glinting off the ocean and the curved horizon wrapped in a thin luminous blue layer of atmosphere. Above the horizon the sky is black: "
        + SKY + ", with " + GIANT + " hanging large and pale in the upper right, and faint green aurora ribbons along the horizon.") + TAIL,
    "03_touchdown": HEAD + (
        "A lander touching down on an airless grey moon. " + LANDER + " It hovers one meter above the regolith, left of center, its descent engine "
        "firing a pale blue flame that blasts dust outward in low flat sheets, footpads about to touch, casting a long hard shadow. In the foreground are "
        "sharp scattered boulders and small craters; beyond are crater rims and rolling grey hills under low sunlight from the left. There is no atmosphere "
        "and the sky is black: " + GIANT + " dominates the upper right of the sky, a second small grey cratered moon floats near it, and the rest of the sky is " + SKY + ".") + TAIL,
    "04_harvest": HEAD + (
        "Ore mining on a small dark asteroid. " + LANDER + " It stands anchored on the rocky ground, left of center. From its side extends a sturdy "
        "articulated robotic mining arm ending in a spinning drill head that bores into a rock outcrop veined with glowing cyan-blue ore crystals; sparks, "
        "dust and rock fragments drift weightlessly. A ribbed hose runs from the drill to a compact refinery module standing beside the lander, with two "
        "spherical tanks, one ringed with an orange band and one with a blue band, lit by work lights and venting a wisp of vapor. The horizon is very close "
        "and curved; other tumbling asteroids float in the distance. Hard sunlight from the right, cool blue fill light from the glowing ore. The sky is "
        + SKY + ", with a distant small ringed gas giant.") + TAIL,
    "05_recovery": HEAD + (
        "A carrier spaceship recovering its spaceplane in orbit of a ringed gas giant. " + CARRIER + " The carrier fills the upper left and center of the "
        "frame, seen from a three-quarter side angle, its white hull sunlit, its big flank hangar bay wide open with warm amber interior light and rows of "
        "small guide lights. " + PLANE + " The spaceplane is small in the lower middle of the frame, seen from behind and slightly above with its nose "
        "pointing at the open hangar bay, flying slowly toward it, with small white thruster puffs at its wingtips. Behind them the huge globe of " + GIANT +
        " fills the right background, the rings sweeping away as one clean tilted ellipse and casting a band of shadow across the cloud tops, with a small "
        "grey moon nearby; the left background is " + SKY + ".") + TAIL,
}

# Seeds of the accepted plates (MOSS-Image SFT int8, Euler / MOSS schedule, 50 steps, CFG 3, 1920x1088, CPU RNG).
SEEDS = {"01_approach": 21, "02_atmosphere": 22, "03_touchdown": 21, "04_harvest": 21, "05_recovery": 24}
