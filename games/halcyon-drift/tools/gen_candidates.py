"""python tools/gen_candidates.py <outdir> <seed>[,<seed>...] [shot ...]  -> native 1920x1088 plates"""
import os, sys
sys.path.insert(0, os.path.dirname(__file__))
from forge import txt2img
from shots import SHOTS
out = sys.argv[1]; seeds = [int(s) for s in sys.argv[2].split(",")]; names = sys.argv[3:] or list(SHOTS)
os.makedirs(out, exist_ok=True)
for seed in seeds:
    for n in names:
        f = os.path.join(out, f"{n}_{seed}.png")
        if os.path.exists(f): continue
        txt2img(SHOTS[n], seed, 1920, 1088).save(f)
        print("saved", f, flush=True)
