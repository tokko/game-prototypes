"""Thin client for the local Forge Neo API (MOSS-Image SFT). Deterministic: fixed seeds, CPU RNG."""
import base64, io, json, sys, time, urllib.request
from PIL import Image
from gpu_gate import wait_idle

API = "http://127.0.0.1:7871"

def _post(path, payload, timeout=1800):
    req = urllib.request.Request(API + path, data=json.dumps(payload).encode(), headers={"Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return json.loads(r.read())

def _b64(img):
    b = io.BytesIO(); img.save(b, "PNG"); return base64.b64encode(b.getvalue()).decode()

BASE = dict(negative_prompt="", sampler_name="Euler", scheduler="MOSS", cfg_scale=3.0, steps=50,
            batch_size=1, n_iter=1, save_images=False, send_images=True, do_not_save_grid=True, do_not_save_samples=True)

def txt2img(prompt, seed, w=1344, h=768, **kw):
    p = dict(BASE, prompt=prompt, seed=seed, width=w, height=h); p.update(kw)
    wait_idle(); t = time.time(); r = _post("/sdapi/v1/txt2img", p)
    img = Image.open(io.BytesIO(base64.b64decode(r["images"][0]))).convert("RGB")
    print(f"txt2img seed={seed} {w}x{h} {time.time()-t:.0f}s", flush=True)
    return img

def img2img(image, prompt, seed, w, h, denoise=0.35, mask=None, **kw):
    p = dict(BASE, prompt=prompt, seed=seed, width=w, height=h, init_images=[_b64(image)],
             denoising_strength=denoise, resize_mode=0); p.update(kw)
    if mask is not None:
        p.update(mask=_b64(mask), inpainting_fill=1, inpaint_full_res=False, mask_blur=kw.get("mask_blur", 24), inpainting_mask_invert=0)
    wait_idle(); t = time.time(); r = _post("/sdapi/v1/img2img", p)
    img = Image.open(io.BytesIO(base64.b64decode(r["images"][0]))).convert("RGB")
    print(f"img2img seed={seed} {w}x{h} d={denoise} {time.time()-t:.0f}s", flush=True)
    return img
