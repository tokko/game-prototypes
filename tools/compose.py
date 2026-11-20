"""Composite the deterministic HUD onto the five generated plates.
Usage: python tools/compose.py <plates_dir> <out_dir> [shot ...]
Fiction: Veyra system - Thalen (ocean world), Oruun (ringed gas giant), Kesh (airless moon of Oruun),
Dray-7 (ore-rich rock in the Sable Belt). Fleet: carrier MERIDIAN, spaceplane KESTREL, lander HERON.
"""
import os, sys
import numpy as np
from PIL import Image, ImageFilter
sys.path.insert(0, os.path.dirname(__file__))
from hud import Hud

def heal(img, cx, cy, rx, ry):
    """Deterministic spot retouch: replace an ellipse with a normalized blur of its surroundings (for stray specks on smooth sky)."""
    from PIL import ImageDraw
    w, h = img.size
    pad = 4 * max(rx, ry)
    box = (max(0, cx - pad), max(0, cy - pad), min(w, cx + pad), min(h, cy + pad))
    sub = img.crop(box)
    m = Image.new("L", sub.size, 0)
    ImageDraw.Draw(m).ellipse([cx - box[0] - rx, cy - box[1] - ry, cx - box[0] + rx, cy - box[1] + ry], fill=255)
    hard = np.asarray(m.filter(ImageFilter.GaussianBlur(3))).astype(np.float32)[..., None] / 255
    hard = np.clip(hard * 3, 0, 1)                                  # generous exclusion zone
    a = np.asarray(sub).astype(np.float32)
    blur = lambda arr: np.asarray(Image.fromarray(np.clip(arr, 0, 255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(max(rx, ry) * 0.6))).astype(np.float32)
    num = blur(a * (1 - hard)); den = blur(np.repeat((1 - hard) * 255, 3, axis=2)) / 255
    fill = num / np.maximum(den, 1e-3)
    soft = np.asarray(m.filter(ImageFilter.GaussianBlur(max(4, min(rx, ry) * 0.35)))).astype(np.float32)[..., None] / 255
    out = a * (1 - soft) + fill * soft
    img = img.copy(); img.paste(Image.fromarray(np.clip(out, 0, 255).astype(np.uint8)), box[:2])
    return img

# per-shot retouches in plate pixel coordinates (cx, cy, rx, ry)
RETOUCH = {"01_approach": [(84, 544, 76, 30)]}

def grade(img, sat=0.90, contrast=1.06, bloom=0.10, vignette=0.22, grain=1.6, seed=7):
    """Deterministic finishing pass: crop to 1920x1080, filmic contrast, bloom, vignette, fine grain."""
    w, h = img.size
    th = round(w * 9 / 16)
    img = img.crop((0, (h - th) // 2, w, (h - th) // 2 + th))
    if img.size != (1920, 1080):
        img = img.resize((1920, 1080), Image.LANCZOS)
    a = np.asarray(img).astype(np.float32) / 255
    lum = (a * [0.2126, 0.7152, 0.0722]).sum(-1, keepdims=True)
    a = lum + (a - lum) * sat
    a = (a - 0.5) * contrast + 0.5
    a = np.clip(a, 0, 1)
    a = a * a * (3 - 2 * a) * 0.35 + a * 0.65                      # gentle S-curve
    hi = Image.fromarray((np.clip((a - 0.72) / 0.28, 0, 1) * 255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(22))
    a = 1 - (1 - a) * (1 - np.asarray(hi).astype(np.float32) / 255 * bloom)   # screen-blend bloom
    yy, xx = np.mgrid[0:1080, 0:1920].astype(np.float32)
    r = np.sqrt(((xx - 960) / 960) ** 2 + ((yy - 540) / 540) ** 2) / 1.414
    a *= (1 - vignette * np.clip(r, 0, 1) ** 2.4)[..., None]
    a += np.random.default_rng(seed).normal(0, grain / 255, (1080, 1920, 1)).astype(np.float32)
    return Image.fromarray((np.clip(a, 0, 1) * 255 + 0.5).astype(np.uint8))

def s01(h):
    # Capture ellipse around Thalen; numbers satisfy vis-viva for a small (R=600 km) game-scale world.
    h.objectives("VEYRA SYSTEM  ·  THALEN", "Approach Thalen",
                 [("Complete transfer burn", "done"), ("Circularize at periapsis", "active"), ("Scan for landing sites", "todo")])
    h.flight_data([("Altitude", "1,842 km"), ("Velocity", "1.03 km/s"), ("Apoapsis", "2,460 km"), ("Periapsis", "212 km"), ("Time to Pe", "06:42")])
    h.navball("Orbit", "1.03 km/s", 90, pitch=5, roll=-3, prograde=(0.26, -0.20), sas=0)
    h.vehicle("carrier", "MERIDIAN", "Carrier", 0.71, 0.68)

def s02(h):
    h.objectives("THALEN  ·  UPPER ATMOSPHERE", "Atmospheric Entry",
                 [("Deorbit burn", "done"), ("Hold entry corridor", "active"), ("Glide to landing zone", "todo")])
    h.flight_data([("Altitude", "41.6 km"), ("Speed", "2,310 m/s"), ("Mach", "7.2"), ("Hull temp", "1,140 °C"), ("G-load", "1.8 g")])
    h.navball("Surface", "2,310 m/s", 94, pitch=-9, roll=7, prograde=(0.10, 0.34), sas=2)
    h.vehicle("plane", "KESTREL", "Spaceplane", 0.46, 0.52)

def s03(h):
    h.objectives("ORUUN  ·  KESH", "Touchdown on Kesh",
                 [("Descent burn", "done"), ("Land softly", "active"), ("Deploy drill", "todo")])
    h.flight_data([("Radar alt", "6 m"), ("Vertical", "-0.8 m/s"), ("Horizontal", "0.2 m/s"), ("Gravity", "0.14 g")])
    h.navball("Surface", "0.8 m/s", 212, pitch=-56, roll=2, prograde=None, sas=1)
    h.vehicle("lander", "HERON", "Lander", 0.38, 0.41)

def s04(h):
    h.objectives("SABLE BELT  ·  DRAY-7", "Harvest & Refine",
                 [("Anchor to surface", "done"), ("Extract ore", "done"), ("Refine fuel and oxidizer", "active"), ("Top up tanks", "todo")])
    h.flight_data([("Ore grade", "Rich"), ("Drill rate", "1.4 t/min"), ("Power", "82 %"), ("Gravity", "0.02 g")])
    h.navball("Surface", "0.0 m/s", 148, pitch=-60, roll=-1, prograde=None, sas=2)
    h.vehicle("lander", "HERON", "Lander", 0.41, 0.50)
    h.refinery(ore=64, fuel=41, ox=50, progress=0.58)
    h.toast(1424, 384, "Ore", "+12")

def s05(h):
    h.objectives("ORUUN  ·  HIGH ORBIT", "Recover Kestrel",
                 [("Match orbit with Meridian", "done"), ("Align with hangar bay", "done"), ("Dock", "active")])
    h.flight_data([("Distance", "240 m"), ("Closing", "1.8 m/s"), ("Alignment", "1.2°"), ("Altitude", "412 km")])
    h.navball("Target", "1.8 m/s", 271, pitch=2, roll=-2, prograde=(0.03, -0.05), sas=3)
    h.vehicle("plane", "KESTREL", "Spaceplane", 0.22, 0.27)

SHOTS = {"01_approach": s01, "02_atmosphere": s02, "03_touchdown": s03, "04_harvest": s04, "05_recovery": s05}

if __name__ == "__main__":
    src, out = sys.argv[1], sys.argv[2]
    os.makedirs(out, exist_ok=True)
    for name in (sys.argv[3:] or SHOTS):
        img = Image.open(os.path.join(src, name + ".png")).convert("RGB")
        for r in RETOUCH.get(name, []):
            img = heal(img, *r)
        img = grade(img)
        h = Hud(img); SHOTS[name](h)
        h.render().save(os.path.join(out, name + ".png"), optimize=True)
        print("wrote", name, img.size)
