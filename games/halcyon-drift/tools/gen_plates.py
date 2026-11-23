"""Regenerate the accepted HUD-less plates: python tools/gen_plates.py <outdir> [shot ...]"""
import os, sys
sys.path.insert(0, os.path.dirname(__file__))
from forge import txt2img
from shots import SHOTS, SEEDS
out = sys.argv[1]; os.makedirs(out, exist_ok=True)
for n in (sys.argv[2:] or list(SHOTS)):
    txt2img(SHOTS[n], SEEDS[n], 1920, 1088).save(os.path.join(out, n + ".png"))
    print("saved", n, flush=True)
