#!/usr/bin/env python3
"""Deterministic painter for the Fogbound Walk apparition billboards (see SPEC.md).

    python paint_apparitions.py            # repaint every PNG next to this file
    python paint_apparitions.py beast_body # repaint one

Needs Python 3.10+, numpy and Pillow only. All randomness is seeded, so the same
numpy/Pillow versions give byte-identical PNGs (painted with numpy 2.2, Pillow 12.2).
Output: straight-alpha sRGB RGBA PNGs. Metre-based paintings use x right from the
left texture edge and y up from the bottom edge (the ground line).
"""
import math
import os
import sys

import numpy as np
from PIL import Image, ImageDraw

HERE = os.path.dirname(os.path.abspath(__file__))
F32 = np.float32


# ---- toolkit --------------------------------------------------------------------------------

def sstep(a, b, x):
    t = np.clip((x - a) / (b - a), 0.0, 1.0)
    return t * t * (3 - 2 * t)


def _gauss(a, s):
    r = max(1, int(math.ceil(s * 3)))
    x = np.arange(-r, r + 1, dtype=F32)
    kk = np.exp(-x * x / (2 * s * s))
    kk /= kk.sum()
    h, w = a.shape
    p = np.pad(a, ((0, 0), (r, r)), mode='edge')
    o = np.zeros_like(a)
    for i, kv in enumerate(kk):
        o += kv * p[:, i:i + w]
    p = np.pad(o, ((r, r), (0, 0)), mode='edge')
    o = np.zeros_like(a)
    for i, kv in enumerate(kk):
        o += kv * p[i:i + h, :]
    return o


def blur(a, s):
    a = np.ascontiguousarray(a, F32)
    if s < 0.3:
        return a
    f = int(s // 4)
    if f < 2:
        return _gauss(a, s)
    h, w = a.shape
    sm = np.asarray(Image.fromarray(a).resize((max(2, w // f), max(2, h // f)), Image.BOX), F32)
    sm = _gauss(sm, s / f)
    return np.asarray(Image.fromarray(sm).resize((w, h), Image.BICUBIC), F32)


def fbm(w, h, cell, seed, octaves=4, sx=1.0, sy=1.0):
    """Fractal value noise in 0..1; cell = size in px of the largest feature, sx/sy stretch it."""
    r = np.random.default_rng(seed)
    out = np.zeros((h, w), F32)
    amp, tot = 1.0, 0.0
    for o in range(octaves):
        cw = max(2, int(round(w / (cell * sx) * 2 ** o)) + 2)
        ch = max(2, int(round(h / (cell * sy) * 2 ** o)) + 2)
        g = r.random((ch, cw), dtype=F32)
        out += amp * np.asarray(Image.fromarray(g).resize((w, h), Image.BICUBIC), F32)
        tot += amp
        amp *= 0.5
    out /= tot
    lo, hi = np.percentile(out, [0.5, 99.5])
    return np.clip((out - lo) / (hi - lo), 0, 1).astype(F32)


def warp(a, dx, dy):
    """Bilinear resample of a at (x + dx, y + dy): bends drawn outlines so nothing stays geometric."""
    h, w = a.shape
    yy, xx = np.mgrid[0:h, 0:w].astype(F32)
    x = np.clip(xx + dx, 0, w - 1.001)
    y = np.clip(yy + dy, 0, h - 1.001)
    x0 = x.astype(np.int32)
    y0 = y.astype(np.int32)
    fx = x - x0
    fy = y - y0
    return (a[y0, x0] * (1 - fx) * (1 - fy) + a[y0, x0 + 1] * fx * (1 - fy)
            + a[y0 + 1, x0] * (1 - fx) * fy + a[y0 + 1, x0 + 1] * fx * fy).astype(F32)


def shift(a, dx, dy):
    return np.roll(np.roll(a, int(round(dy)), 0), int(round(dx)), 1)


def smear_down(a, n, decay=0.93):
    """Drag a mask downward by n px with fading weight (a wet smear)."""
    out = np.zeros_like(a)
    wsum, wgt = 0.0, 1.0
    for i in range(n):
        out += wgt * np.roll(a, i, 0)
        wsum += wgt
        wgt *= decay
    return out / wsum


def toplight(d, sigma, lx=0.0, ly=-1.0):
    """Where the soft density d falls away toward (lx, ly) (image coords): the faces turned to a light there."""
    b = blur(d, sigma)
    gy, gx = np.gradient(b)
    return np.clip(-(gx * lx + gy * ly) * sigma * 2.6, 0, 1).astype(F32)


def spline(pts, n=None):
    p = np.asarray(pts, float)
    p = np.vstack([p[:1], p, p[-1:]])
    out = []
    for i in range(1, len(p) - 2):
        p0, p1, p2, p3 = p[i - 1], p[i], p[i + 1], p[i + 2]
        m = n or int(max(8, np.hypot(*(p2 - p1)[:2]) / 0.6))
        for t in np.arange(m) / m:
            out.append(0.5 * (2 * p1 + (p2 - p0) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t * t
                              + (3 * p1 - p0 - 3 * p2 + p3) * t ** 3))
    out.append(p[-2])
    return np.array(out)


def ell(cx, cy, rx, ry, ang=0.0, n=44):
    c, s = math.cos(math.radians(ang)), math.sin(math.radians(ang))
    return [(cx + rx * math.cos(t) * c - ry * math.sin(t) * s, cy + rx * math.cos(t) * s + ry * math.sin(t) * c)
            for t in np.linspace(0, 2 * math.pi, n, endpoint=False)]


def rot(pts, ang, cx, cy):
    c, s = math.cos(math.radians(ang)), math.sin(math.radians(ang))
    return [(cx + x * c - y * s, cy + x * s + y * c) for x, y in pts]


class Pen:
    """Solid shapes in pixel coordinates, supersampled; get() returns a 0..1 coverage mask."""

    def __init__(self, w, h, ss=2):
        self.w, self.h, self.ss = w, h, ss
        self.im = Image.new('L', (w * ss, h * ss), 0)
        self.d = ImageDraw.Draw(self.im)

    def dot(self, x, y, r, v=255):
        s = self.ss
        r = max(r, 0.35)
        self.d.ellipse(((x - r) * s, (y - r) * s, (x + r) * s, (y + r) * s), fill=v)

    def limb(self, pts, v=255):
        """Tapered stroke through (x, y, radius) points."""
        for x, y, r in spline(pts):
            self.dot(x, y, r, v)

    def poly(self, pts, v=255):
        self.d.polygon([(x * self.ss, y * self.ss) for x, y in pts], fill=v)

    def get(self):
        return np.asarray(self.im.resize((self.w, self.h), Image.BOX), F32) / 255.0


class Strands:
    """Thin tapered strokes (hair, tatters). Segments are drawn in order of opacity so dense ones win."""

    def __init__(self, w, h, ss=3):
        self.w, self.h, self.ss, self.seg = w, h, ss, []

    def add(self, pts, w0, w1, v0=1.0, v1=1.0, n=14, ease=0.0):
        q = spline(pts, n)
        m = len(q) - 1
        for i in range(m):
            t = i / max(1, m - 1)
            v = (v0 + (v1 - v0) * t) * (min(1.0, (t + 0.02) / ease) if ease else 1.0)   # ease: fade in from the root
            self.seg.append((v, w0 + (w1 - w0) * t, q[i], q[i + 1]))

    def get(self):
        s = self.ss
        im = Image.new('L', (self.w * s, self.h * s), 0)
        d = ImageDraw.Draw(im)
        for v, wd, a, b in sorted(self.seg, key=lambda e: e[0]):
            f = int(max(0, min(255, round(255 * v))))
            pw = max(1, int(round(wd * s)))
            d.line((a[0] * s, a[1] * s, b[0] * s, b[1] * s), fill=f, width=pw)
            if pw >= 3:
                r = pw / 2
                d.ellipse((b[0] * s - r, b[1] * s - r, b[0] * s + r, b[1] * s + r), fill=f)
        return np.asarray(im.resize((self.w, self.h), Image.BOX), F32) / 255.0


class Layer:
    """Premultiplied float RGBA accumulator; colours are sRGB 0..255."""

    def __init__(self, w, h):
        self.c = np.zeros((h, w, 3), F32)
        self.a = np.zeros((h, w), F32)

    def over(self, col, alpha):
        col = np.asarray(col, F32)
        if col.ndim == 1:
            col = col[None, None, :]
        al = np.clip(alpha, 0, 1)[..., None]
        self.c = col * al + self.c * (1 - al)
        self.a = al[..., 0] + self.a * (1 - al[..., 0])

    def fade(self, k):
        self.c *= k[..., None]
        self.a *= k

    def save(self, name, fill, seed):
        a = np.clip(self.a, 0, 1)
        ca = blur(self.a, 5)
        cc = np.stack([blur(self.c[..., i], 5) for i in range(3)], -1)
        solid = self.c / np.maximum(a, 1e-4)[..., None]
        bleed = cc / np.maximum(ca, 1e-5)[..., None]      # colour carried a little past the edge (no fringes)
        rgb = np.where((a > 0.03)[..., None], solid,
                       np.where((ca > 0.004)[..., None], bleed, np.asarray(fill, F32)[None, None, :]))
        r = np.random.default_rng(seed)
        a8 = a * 255 + (r.random(a.shape, dtype=F32) - 0.5)   # dither: faint haze must not band
        a8 = np.where(a * 255 < 0.6, 0, a8)
        out = np.dstack([np.clip(np.rint(rgb), 0, 255), np.clip(np.rint(a8), 0, 255)]).astype(np.uint8)
        out[out[..., 3] == 0, :3] = np.asarray(fill, np.uint8)
        path = os.path.join(HERE, name)
        Image.fromarray(out, 'RGBA').save(path, optimize=True)
        print(f'{name}: {out.shape[1]}x{out.shape[0]}, {os.path.getsize(path) / 1024:.0f} KB')


def bony(pen, P, joints, knob=1.2, waist=0.76):
    """An emaciated limb through (x, y, radius) joints in metres: straight bones, thin between the joints."""
    for (x0, y0, r0), (x1, y1, r1) in zip(joints, joints[1:]):
        pen.limb(P((x0, y0, r0), ((x0 + x1) / 2, (y0 + y1) / 2, (r0 + r1) / 2 * waist), (x1, y1, r1)))
    for x, y, r in joints[1:-1]:
        pen.dot(*P((x, y, r * knob))[0])


def metres(w, h, pw, ph):
    """Helpers for a painting laid out in metres on a pw x ph plane."""
    k = w / pw

    def P(*pts):   # (x, y) or (x, y, radius) in metres -> pixels
        return [(p[0] * k, (ph - p[1]) * k) + tuple(v * k for v in p[2:]) for p in pts]

    yy, xx = np.mgrid[0:h, 0:w].astype(F32)
    return k, P, xx / k, ph - yy / k


def edge_window(X, Y, pw, ph, m=0.07, left=True, bottom=0.03):
    """Alpha falls to zero before every plane edge, so the quad itself can never show."""
    k = sstep(pw, pw - m, X) * sstep(ph, ph - m, Y) * sstep(0.0, bottom, Y)
    return k * sstep(0.0, m, X) if left else k


# ---- forest: the thing behind the stone -----------------------------------------------------
# 1.3 x 2.6 m. Cover (stone) side is the LEFT edge: everything left of x ~ 0.2 m is meant to be hidden.
BEAST_HEAD = (0.74, 1.70)   # m; centre of the eye line
BEAST_TILT = -12.0          # deg, clockwise as seen by the camera


def paint_beast_body():
    W, H, pw, ph = 512, 1024, 1.30, 2.60
    k, P, X, Y = metres(W, H, pw, ph)
    n_lo, n_mid, n_hi = fbm(W, H, 150, 101), fbm(W, H, 46, 102), fbm(W, H, 13, 103, 3)
    n_smk = fbm(W, H, 70, 104, 4, sx=0.5, sy=1.9)
    wx, wy = fbm(W, H, 90, 105, 3) - 0.5, fbm(W, H, 90, 106, 3) - 0.5
    bend = lambda m, amp: warp(m, wx * amp, wy * amp)
    rr = np.random.default_rng(107)

    # long skull seen from the front: broad across the brow (the eyes sit far apart), then a narrow hanging muzzle
    skull = [(-0.31, 0.03), (-0.29, 0.13), (-0.19, 0.20), (-0.04, 0.225), (0.10, 0.215), (0.24, 0.17), (0.31, 0.08),
             (0.32, -0.02), (0.27, -0.10), (0.185, -0.17), (0.145, -0.27), (0.125, -0.40), (0.10, -0.50),
             (0.03, -0.545), (-0.05, -0.535), (-0.10, -0.47), (-0.115, -0.36), (-0.14, -0.25), (-0.19, -0.16), (-0.27, -0.09)]
    pen = Pen(W, H)
    pen.poly(P(*rot(skull, BEAST_TILT, *BEAST_HEAD)))
    pen.limb(P((0.08, 2.20, 0.20), (0.33, 2.10, 0.11), (0.52, 1.985, 0.078), (0.66, 1.86, 0.092)))   # thin neck
    head = pen.get()

    pen = Pen(W, H)                                   # the bulk: a high arched back, almost all behind the stone
    pen.poly(P(*ell(0.03, 1.92, 0.33, 0.50)))
    pen.poly(P(*ell(0.13, 2.24, 0.22, 0.19)))
    hump = pen.get()

    def foreleg(sh, el, wr, kn, tips):                # thin jointed leg, fingers arched like a spider on its tips
        pen = Pen(W, H, 3)
        bony(pen, P, [sh, el, wr, kn])
        for mid, tip in tips:
            pen.limb(P(kn[:2] + (0.014,), mid + (0.011,), tip + (0.0055,)))
        return pen.get()

    leg = foreleg((0.18, 1.64, 0.07), (0.505, 1.02, 0.037), (0.425, 0.25, 0.025), (0.455, 0.125, 0.027),
                  [((0.585, 0.135), (0.71, 0.03)), ((0.545, 0.10), (0.615, 0.018)), ((0.50, 0.075), (0.515, 0.012)),
                   ((0.40, 0.10), (0.345, 0.025))])
    leg2 = foreleg((0.06, 1.50, 0.06), (0.30, 0.90, 0.032), (0.235, 0.22, 0.022), (0.255, 0.11, 0.024),
                   [((0.33, 0.10), (0.40, 0.02)), ((0.29, 0.07), (0.31, 0.012)), ((0.21, 0.08), (0.17, 0.02))])

    st = Strands(W, H)                                # wet tatters hanging from the neck and jaw
    roots = [(0.30 + 0.34 * t, 2.04 - 0.24 * t) for t in rr.random(18)] + \
            [(0.55 + 0.17 * t, 1.22 + 0.12 * rr.random()) for t in rr.random(11)]
    for x0, y0 in roots:
        ln, sw = 0.22 + 0.42 * rr.random(), (rr.random() - 0.5) * 0.07
        pts = P((x0, y0), (x0 + sw * 0.3, y0 - ln * 0.4), (x0 + sw, y0 - ln * 0.75), (x0 + sw * 0.7, y0 - ln))
        st.add(pts, 2.0 + 2.6 * rr.random(), 0.7, 0.95, 0.0)
    crest = [(0.24 + 0.42 * t, 2.21 - 0.31 * t) for t in rr.random(26)]            # bristles along neck and crown
    c, s_ = math.cos(math.radians(BEAST_TILT)), math.sin(math.radians(BEAST_TILT))
    for t in rr.random(30):
        lx = -0.30 + 0.61 * t
        ly = 0.20 - 0.9 * (lx - 0.02) ** 2
        crest.append((BEAST_HEAD[0] + lx * c - ly * s_, BEAST_HEAD[1] + lx * s_ + ly * c))
    for x0, y0 in crest:
        ln, lean = 0.05 + 0.13 * rr.random() ** 1.5, -0.03 - 0.07 * rr.random()
        st.add(P((x0, y0 - 0.02), (x0 + lean * 0.5, y0 + ln * 0.6), (x0 + lean, y0 + ln)), 2.2 + 2.4 * rr.random(), 0.6, 0.9, 0.0, n=8)
    tat = blur(st.get(), 0.9)

    d_head = blur(bend(head, 24), 8.0)
    a_head = sstep(0.36, 0.72, d_head + (n_mid - 0.5) * 0.52 + (n_hi - 0.5) * 0.14) * (0.84 + 0.14 * n_lo)
    a_head *= 1 - 0.55 * sstep(0.88, 1.10, X) * (1 - n_mid)            # the far cheek is going to smoke
    d_hump = blur(bend(hump, 34), 16)
    thin = sstep(2.55, 1.85, Y) * sstep(0.62, 0.12, X)                 # dissolves upward and away from the cover
    a_hump = sstep(0.28, 0.80, d_hump * (0.5 + 0.95 * n_mid)) * (0.30 + 0.66 * thin)
    part = 0.66 + 0.34 * sstep(0.25, 0.7, n_lo * 0.6 + n_smk * 0.4)      # the leg is not all there
    a_leg = sstep(0.28, 0.62, blur(bend(leg, 9), 2.2) + (n_hi - 0.5) * 0.24) * (0.62 + 0.34 * sstep(0.1, 1.2, Y)) * part
    a_leg2 = sstep(0.25, 0.72, blur(bend(leg2, 12), 4.2) + (n_mid - 0.5) * 0.3) * (0.22 + 0.36 * n_smk) * sstep(0.0, 0.5, Y + n_lo * 0.3)
    a_tat = tat * 0.85 * sstep(0.2, 0.55, n_mid * 0.5 + 0.35)

    solid = np.maximum.reduce([head, hump, leg])
    env = blur(warp(solid, wx * 46, wy * 46 + 16), 26)                # smoke lifting off it
    a_smk = sstep(0.10, 0.75, env * (0.35 + 1.1 * n_smk)) * 0.44
    a_mist = np.exp(-((X - 0.44) / 0.42) ** 2 - ((Y - 0.10) / 0.13) ** 2) * sstep(0.3, 0.8, n_mid * 0.6 + n_lo * 0.5) * 0.42

    base = np.array([3, 4, 7], F32)[None, None, :] + n_lo[..., None] * np.array([6, 7, 11], F32)
    form = 1 - (1 - a_head) * (1 - a_leg) * (1 - a_hump)
    lit = toplight(form, 4.0, 0.25, -1.0) * (0.25 + 0.95 * n_mid) * sstep(0.25, 0.7, form)   # broken cold wet sheen
    warm = toplight(form, 5.0, 0.86, -0.5) * (0.15 + 1.0 * n_mid) * sstep(0.25, 0.7, form) * sstep(0.35, 0.75, X)   # lantern side
    col = base + lit[..., None] * np.array([27, 35, 47], F32) * 0.7 + warm[..., None] * np.array([96, 66, 36], F32) * 0.55

    L = Layer(W, H)
    L.over((6, 8, 12), a_smk)
    L.over((5, 7, 11), a_mist)
    L.over((7, 9, 14), a_leg2)
    L.over(col, a_hump)
    L.over(col, a_leg)
    L.over(base, a_tat)
    L.over(col, a_head)
    L.fade(edge_window(X, Y, pw, ph, left=False) * sstep(0.0, 0.05, X))
    L.save('beast_body.png', (4, 5, 8), 108)


def paint_hand(name, size, lengths, gap, r0, r1, skin, shade, alpha, shadow, seed):
    """Four long fingers hooked round an edge. The edge is the RIGHT side of the texture; fingers reach left."""
    W = H = 256
    k, P, X, Y = metres(W, H, size, size)
    rr = np.random.default_rng(seed)
    n_mid, n_hi = fbm(W, H, 40, seed + 1), fbm(W, H, 11, seed + 2, 3)
    wx, wy = fbm(W, H, 60, seed + 3, 3) - 0.5, fbm(W, H, 60, seed + 4, 3) - 0.5
    pen = Pen(W, H, 3)
    y0 = size * 0.5 + gap * 1.5 + 0.01
    for i, ln in enumerate(lengths):
        yb = y0 - gap * i
        fan = (1.5 - i) * 0.014                                      # tips spread a little
        rj = lambda t: r0 + (r1 - r0) * t
        joints = [(size + 0.03, yb - 0.006, r0),
                  (size - ln * 0.30, yb + fan * 0.3 + 0.011 + 0.004 * rr.random(), rj(0.3)),
                  (size - ln * 0.60, yb + fan * 0.7 + 0.005 * rr.random(), rj(0.6)),
                  (size - ln * 0.84, yb + fan * 0.9 - 0.010 - 0.004 * rr.random(), rj(0.85)),
                  (size - ln, yb + fan - 0.034 - 0.010 * rr.random(), r1)]   # last joint hooks down onto the surface
        bony(pen, P, joints, 1.2, 0.84)
    m = warp(pen.get(), wx * 3, wy * 3)
    a = sstep(0.25, 0.7, blur(m, 1.1) + (n_hi - 0.5) * 0.12) * alpha
    emerge = sstep(size + 0.005, size - 0.11, X)                     # fingers come out of the shadow of the edge
    lit = toplight(a, 1.6, 0.2, -1.0)
    tone = (0.42 + 0.58 * emerge) * (0.78 + 0.3 * n_mid)
    col = (np.asarray(shade, F32)[None, None, :] * (1 - lit[..., None])
           + np.asarray(skin, F32)[None, None, :] * lit[..., None]) * tone[..., None]
    L = Layer(W, H)
    L.over((3, 4, 6), blur(shift(m, -1, 4), 3.2) * shadow)            # contact shadow seats it on the surface
    L.over(col, a)
    L.fade(sstep(size, size - 0.035, X) * sstep(0.0, 0.03, X) * sstep(0.0, 0.03, Y) * sstep(size, size - 0.03, Y))
    L.save(name, tuple(int(v * 0.5) for v in shade), seed + 5)


def paint_beast_hand():
    paint_hand('beast_hand.png', 0.50, (0.27, 0.35, 0.37, 0.30), 0.052, 0.0165, 0.0085,
               skin=(30, 38, 50), shade=(4, 5, 8), alpha=0.96, shadow=0.38, seed=120)


def paint_figure_hand():
    paint_hand('figure_hand.png', 0.40, (0.235, 0.30, 0.315, 0.255), 0.039, 0.0098, 0.0062,
               skin=(176, 182, 188), shade=(104, 110, 120), alpha=0.95, shadow=0.55, seed=220)


# ---- manor: the tall one --------------------------------------------------------------------
# Both textures 1.4 x 2.8 m, ground line at the bottom edge.

def _figure_noise(W, H, seed):
    return (fbm(W, H, 150, seed), fbm(W, H, 46, seed + 1), fbm(W, H, 13, seed + 2, 3),
            fbm(W, H, 70, seed + 3, 4, sx=0.5, sy=1.9), fbm(W, H, 90, seed + 4, 3) - 0.5, fbm(W, H, 90, seed + 5, 3) - 0.5,
            fbm(W, H, 50, seed + 6, 3, sx=0.3, sy=3.5))


def _hanging(W, H, P, rr, roots, lo, hi, w0=1.6, w1=1.8):
    st = Strands(W, H)
    for x0, y0 in roots:
        ln, sw = lo + (hi - lo) * rr.random() ** 1.4, (rr.random() - 0.5) * 0.05
        pts = P((x0, y0), (x0 + sw * 0.3, y0 - ln * 0.4), (x0 + sw, y0 - ln * 0.75), (x0 + sw * 0.8, y0 - ln))
        st.add(pts, w0 + w1 * rr.random(), 0.6, 0.92, 0.0, n=18, ease=0.16)
    return blur(st.get(), 0.8)


def _hand(pen, P, wx, wy, tips, r=0.0085):
    pen.limb(P((wx, wy + 0.04, 0.021), (wx, wy - 0.035, 0.027)))
    for tx, ty, bow in tips:
        kx, ky = wx + (tx - wx) * 0.45 + bow, wy - 0.045 + (ty - wy + 0.045) * 0.45
        bony(pen, P, [(wx + (tx - wx) * 0.3, wy - 0.045, r * 1.2), (kx, ky, r), (tx, ty, r * 0.6)], 1.15, 0.85)


def _head(W, H, P, X, Y, bend, rr, n_mid, n_str, hx, hy, ang, neck):
    """The head lying on its side (crown to the right): skull, a pale smear for a face, hair hanging from the crown.
    Returns skull alpha, smear alpha, the dim band and the hair alpha."""
    c, s_ = math.cos(math.radians(ang)), math.sin(math.radians(ang))
    at = lambda d, e=0.0: (hx + d * c - e * s_, hy + d * s_ + e * c)    # d along the chin-to-crown axis, e across it
    along = (X - hx) * c + (Y - hy) * s_
    pen = Pen(W, H)
    bony(pen, P, neck, 1.14, 0.84)                                       # a neck with too many joints in it
    pen.poly(P(*ell(hx, hy, 0.158, 0.098, ang)))
    skull = pen.get()
    a_skull = sstep(0.32, 0.64, blur(bend(skull, 7), 3.4) + (n_mid - 0.5) * 0.2) * 0.97
    spill = np.clip(blur(a_skull, 5) * 1.5, 0, 1)                        # the smear runs a little past the jaw
    pen = Pen(W, H)
    pen.poly(P(*ell(*at(-0.03), 0.120, 0.080, ang)))
    smear = smear_down(blur(bend(pen.get(), 7), 3.6), 34) * (0.30 + 0.62 * n_mid + 0.5 * n_str)
    smear = np.clip(smear * 1.3, 0, 1) * spill * sstep(0.10, 0.0, along)  # lost under the hair toward the crown
    pen = Pen(W, H)
    pen.poly(P(*ell(*at(-0.03, 0.006), 0.019, 0.060, ang)))              # one dim band where eyes would be
    dark = np.clip(smear_down(blur(bend(pen.get(), 5), 4.0), 14) * 1.2, 0, 1) * a_skull
    pen = Pen(W, H)                                                      # hair: a dark fall from the crown, then strands
    bot = at(0.10, -0.24)
    pen.poly(P(at(0.05, 0.06), at(0.16, 0.02), at(0.165, -0.06), (bot[0] + 0.035, bot[1]), (bot[0] - 0.045, bot[1] + 0.03), at(0.03, -0.085)))
    fall = sstep(0.34, 0.95, blur(bend(pen.get(), 12), 8) * (0.45 + 1.0 * n_str)) * 0.58
    roots = [at(0.02 + 0.14 * t, 0.04 - 0.11 * rr.random()) for t in rr.random(32)] + \
            [at(-0.07 + 0.09 * t, 0.03 - 0.06 * rr.random()) for t in rr.random(6)]
    hair = _hanging(W, H, P, rr, roots, 0.28, 1.0, 1.6, 2.6)
    return a_skull, smear, dark, np.clip(fall + hair * 0.88, 0, 1)


def paint_figure_stand():
    """Far too tall for the corridor: the neck has run out of ceiling, so the head lies over on its side above one shoulder."""
    W, H, pw, ph = 512, 1024, 1.40, 2.80
    k, P, X, Y = metres(W, H, pw, ph)
    n_lo, n_mid, n_hi, n_smk, wx, wy, n_str = _figure_noise(W, H, 201)
    bend = lambda m, amp: warp(m, wx * amp, wy * amp)
    rr = np.random.default_rng(207)

    pen = Pen(W, H)   # a narrow shroud hanging from uneven shoulders; whatever legs it has are inside it
    pen.poly(P((0.50, 2.42), (0.60, 2.49), (0.71, 2.50), (0.82, 2.44), (0.90, 2.32), (0.865, 2.00), (0.815, 1.60),
               (0.83, 1.00), (0.855, 0.42), (0.70, 0.36), (0.525, 0.42), (0.56, 1.00), (0.585, 1.60), (0.555, 2.03)))
    shroud = pen.get()
    pen = Pen(W, H, 3)   # arms hang well past where knees would be
    pen.limb(P((0.50, 2.39, 0.042), (0.44, 1.95, 0.030), (0.405, 1.50, 0.029), (0.385, 1.05, 0.022), (0.37, 0.66, 0.019)))
    pen.limb(P((0.895, 2.30, 0.042), (0.955, 1.90, 0.030), (0.99, 1.45, 0.029), (1.005, 1.02, 0.022), (1.012, 0.64, 0.019)))
    arms = pen.get()
    pen = Pen(W, H, 3)
    _hand(pen, P, 0.37, 0.62, [(0.322, 0.36, -0.008), (0.352, 0.31, 0.0), (0.383, 0.30, 0.004), (0.412, 0.345, 0.01)])
    _hand(pen, P, 1.012, 0.60, [(0.966, 0.335, -0.008), (0.998, 0.285, 0.0), (1.029, 0.275, 0.004), (1.058, 0.325, 0.01)])
    hands = pen.get()
    # the neck goes up, meets the ceiling and folds: the head lies over above one shoulder
    a_head, smear, dark, a_hair = _head(W, H, P, X, Y, bend, rr, n_mid, n_str, 0.925, 2.578, -15.0,
                                        [(0.685, 2.45, 0.054), (0.70, 2.55, 0.042), (0.755, 2.622, 0.04), (0.83, 2.62, 0.046)])
    rags = _hanging(W, H, P, rr, [(0.53 + 0.32 * t, 0.36 + 0.5 * rr.random() ** 2) for t in rr.random(26)]
                    + [(0.41 + 0.04 * t, 1.2 + 0.6 * t) for t in rr.random(6)] + [(0.985 - 0.03 * t, 1.15 + 0.6 * t) for t in rr.random(6)], 0.10, 0.40, 1.8, 2.6)

    a_shroud = sstep(0.32, 0.66, blur(bend(shroud, 12), 4.5) + (n_mid - 0.5) * 0.30 + (n_hi - 0.5) * 0.10) * (0.84 + 0.14 * n_lo)
    a_shroud *= 0.12 + 0.88 * sstep(0.25, 1.35, Y)                      # it thins toward the floor ...
    a_shroud *= sstep(0.0, 0.5, n_str + (Y - 0.62) * 1.5)               # ... and the hem is in strips
    gone = 0.62 + 0.38 * sstep(0.25, 0.7, n_lo * 0.6 + n_smk * 0.4)     # stretches of arm drop out
    a_arm = sstep(0.30, 0.62, blur(bend(arms, 7), 2.0) + (n_hi - 0.5) * 0.2) * 0.92 * gone
    a_hand = sstep(0.22, 0.6, blur(bend(hands, 4), 1.0) + (n_hi - 0.5) * 0.1) * 0.9
    a_rags = rags * 0.7

    solid = np.maximum.reduce([shroud, arms])
    env = blur(warp(solid, wx * 30, wy * 30 + 8), 16)
    a_smk = sstep(0.12, 0.8, env * (0.4 + 1.0 * n_smk)) * 0.26

    form = 1 - (1 - a_shroud) * (1 - a_arm) * (1 - a_head)
    high = sstep(0.8, 2.45, Y)
    lit = toplight(form, 4.5, 0.0, -1.0) * (0.3 + 0.9 * n_mid) * sstep(0.25, 0.7, form) * high   # the lamp finds the tops
    chest = np.exp(-((X - 0.70) / 0.17) ** 2 - ((Y - 2.22) / 0.30) ** 2) * (0.35 + 0.85 * n_str)  # and the folds on the chest
    base = np.array([6, 7, 10], F32)[None, None, :] + n_lo[..., None] * np.array([5, 5, 6], F32)
    col = base + lit[..., None] * np.array([122, 98, 68], F32) + chest[..., None] * np.array([33, 27, 19], F32)
    pale = np.array([156, 153, 148], F32)[None, None, :] * (0.70 + 0.30 * n_lo[..., None])

    L = Layer(W, H)
    L.over((5, 6, 9), a_smk)
    L.over(col, a_shroud)
    L.over(base, a_rags)
    L.over(col, a_arm)
    L.over(col + np.array([70, 70, 72], F32) * sstep(0.72, 0.3, Y)[..., None], a_hand)   # the fingers pick up a little light
    L.over(col, a_head)
    L.over(pale, smear * 0.84)
    L.over((22, 21, 23), dark * 0.42)
    L.over(base, a_hair)
    L.fade(edge_window(X, Y, pw, ph, bottom=0.02))
    L.save('figure_stand.png', (6, 7, 10), 208)


def paint_figure_lean():
    """Leaning out from behind the left jamb, far too high up: a head on its side, hair hanging straight down, one long arm."""
    W, H, pw, ph = 512, 1024, 1.40, 2.80
    k, P, X, Y = metres(W, H, pw, ph)
    n_lo, n_mid, n_hi, n_smk, wx, wy, n_str = _figure_noise(W, H, 231)
    bend = lambda m, amp: warp(m, wx * amp, wy * amp)
    rr = np.random.default_rng(237)

    pen = Pen(W, H)   # the edge of a shoulder and flank that clears the jamb; gone by hip height
    pen.poly(P((0, 2.52), (0.10, 2.50), (0.20, 2.41), (0.245, 2.22), (0.235, 1.90), (0.20, 1.50), (0.14, 1.10), (0.06, 0.80), (0, 0.70)))
    torso = pen.get()
    pen = Pen(W, H, 3)
    pen.limb(P((0.15, 1.99, 0.044), (0.265, 1.62, 0.031), (0.345, 1.28, 0.029), (0.325, 0.95, 0.022), (0.30, 0.62, 0.019)))
    arm = pen.get()
    pen = Pen(W, H, 3)
    _hand(pen, P, 0.30, 0.58, [(0.252, 0.32, -0.008), (0.282, 0.27, 0.0), (0.313, 0.26, 0.004), (0.342, 0.305, 0.01)])
    hands = pen.get()
    a_head, smear, dark, a_hair = _head(W, H, P, X, Y, bend, rr, n_mid, n_str, 0.385, 2.355, -12.0,
                                        [(0.03, 2.41, 0.075), (0.16, 2.405, 0.052), (0.24, 2.38, 0.046), (0.30, 2.375, 0.048)])
    rags = _hanging(W, H, P, rr, [(0.17 + 0.17 * t, 1.92 - 0.62 * t) for t in rr.random(9)], 0.10, 0.34)

    a_torso = sstep(0.32, 0.66, blur(bend(torso, 10), 4.5) + (n_mid - 0.5) * 0.28 + (n_hi - 0.5) * 0.1) * 0.95 * (0.2 + 0.8 * sstep(0.7, 1.7, Y))
    gone = 0.66 + 0.34 * sstep(0.25, 0.7, n_lo * 0.6 + n_smk * 0.4)
    a_arm = sstep(0.30, 0.62, blur(bend(arm, 7), 2.0) + (n_hi - 0.5) * 0.2) * 0.93 * gone
    a_hand = sstep(0.22, 0.6, blur(bend(hands, 4), 1.0) + (n_hi - 0.5) * 0.1) * 0.9
    a_rags = rags * 0.7

    solid = np.maximum.reduce([torso, arm])
    env = blur(warp(solid, wx * 30, wy * 30 + 8), 16)
    a_smk = sstep(0.12, 0.8, env * (0.4 + 1.0 * n_smk)) * 0.26

    form = 1 - (1 - a_torso) * (1 - a_arm) * (1 - a_head)
    lit = toplight(form, 3.6, 0.62, -0.78) * (0.25 + 0.95 * n_mid) * sstep(0.25, 0.7, form) * sstep(0.4, 2.3, Y)
    base = np.array([6, 7, 10], F32)[None, None, :] + n_lo[..., None] * np.array([5, 5, 6], F32)
    col = base + lit[..., None] * np.array([140, 98, 54], F32) * 0.8          # hall lamp behind it: a broken amber rim
    shade = 0.55 + 0.45 * sstep(0.22, 0.46, X)                                # the jamb's shadow lies across the face
    pale = np.array([140, 143, 148], F32)[None, None, :] * ((0.70 + 0.30 * n_lo) * shade)[..., None]

    L = Layer(W, H)
    L.over((5, 6, 9), a_smk)
    L.over(col, a_torso)
    L.over(base, a_rags)
    L.over(col, a_arm)
    L.over(col + np.array([74, 72, 70], F32) * sstep(0.72, 0.3, Y)[..., None], a_hand)
    L.over(col, a_head)
    L.over(pale, smear * 0.82)
    L.over((20, 20, 23), dark * 0.42)
    L.over(base, a_hair)
    L.fade(edge_window(X, Y, pw, ph, left=False, bottom=0.02) * sstep(0.0, 0.05, X))
    L.save('figure_lean.png', (6, 7, 10), 238)


# ---- village: the woman behind the glass ----------------------------------------------------
# 320 x 512 on the existing 0.62 x 0.99 m plane; composition and palette follow the old womanTex.

def paint_woman(near):
    W, H = 320, 512
    yy, xx = np.mgrid[0:H, 0:W].astype(F32)
    V = yy / H
    rr = np.random.default_rng(301)                    # same seed for both stages: it is the same hair
    th = math.radians(6.5 if near else 2.5)
    hx, hy = (0.010, 0.014) if near else (0.0, 0.0)
    pvx, pvy = 0.5 * W, 0.57 * H

    def T(u, v, wgt=1.0):   # head pose: tilt about the base of the neck, in px
        x, y = u * W - pvx, v * H - pvy
        a = th * wgt
        return (pvx + x * math.cos(a) - y * math.sin(a) + hx * W * wgt, pvy + x * math.sin(a) + y * math.cos(a) + hy * H * wgt)

    hang = lambda v: float(sstep(0.80, 0.36, v))        # hair follows the head near the scalp, gravity lower down
    folds = fbm(W, H, 40, 302, 3, sx=0.35, sy=5)
    n_mid, n_hi = fbm(W, H, 36, 303), fbm(W, H, 9, 304, 3)
    L = Layer(W, H)

    # faint room light on the curtain behind her
    d = np.hypot(xx - 0.5 * W, (yy - 0.36 * H) / 1.1)
    halo = 0.34 * sstep(178, 6, d) ** 1.25 * (0.78 + 0.44 * folds)
    L.over((110, 120, 132), halo * sstep(0, 26, xx) * sstep(W - 1, W - 27, xx) * sstep(0, 26, yy))

    # shoulders and dress
    lift = 0.022 if near else 0.0                       # her right shoulder rises with the arm
    pen = Pen(W, H)
    pts = [(0.025, 1.0)]
    for t in np.linspace(0, 1, 16):
        pts.append(((1 - t) ** 2 * 0.025 + 2 * t * (1 - t) * 0.0625 + t * t * 0.34,
                    (1 - t) ** 2 * 1.0 + 2 * t * (1 - t) * (0.70 - lift) + t * t * (0.63 - lift * 0.4)))
    for t in np.linspace(0, 1, 16):
        pts.append(((1 - t) ** 2 * 0.66 + 2 * t * (1 - t) * 0.9375 + t * t * 0.975, (1 - t) ** 2 * 0.63 + 2 * t * (1 - t) * 0.70 + t * t * 1.0))
    pen.poly([(u * W, v * H) for u, v in pts])
    dress = pen.get()
    a_dress = sstep(0.15, 0.85, blur(dress, 2.6))
    tone = (0.74 + 0.34 * folds) * (0.70 + 0.30 * blur(dress, 9)) * (1 - 0.3 * sstep(0.72, 1.0, V))
    L.over(np.array([58, 64, 72], F32)[None, None, :] * tone[..., None], a_dress * 0.97)

    # hair behind the neck and lying on the shoulders: a soft mass, its ends are strands (below)
    pen = Pen(W, H)
    back = [(0.262, 0.27), (0.25, 0.45), (0.262, 0.60), (0.30, 0.69), (0.37, 0.64), (0.42, 0.57), (0.58, 0.57),
            (0.63, 0.64), (0.70, 0.69), (0.738, 0.60), (0.75, 0.45), (0.738, 0.27), (0.5, 0.2)]
    pen.poly([T(u, v, hang(v)) for u, v in back])
    a_back = sstep(0.30, 0.80, blur(pen.get(), 4.5) + (n_hi - 0.5) * 0.35) * 0.92 * (0.25 + 0.75 * sstep(0.71, 0.52, V))   # ends in strands
    L.over((3, 3, 5), a_back)

    # skin: chest, neck, face
    pen = Pen(W, H)
    pen.poly([(0.36 * W, 0.638 * H), (0.438 * W, 0.598 * H), (0.562 * W, 0.598 * H), (0.64 * W, 0.638 * H), (0.5 * W, 0.78 * H)])
    pen.poly([T(0.442, 0.50, 0.6), T(0.558, 0.50, 0.6), (0.566 * W, 0.645 * H), (0.434 * W, 0.645 * H)])
    a_neck = sstep(0.15, 0.85, blur(pen.get(), 2.8))
    chin_shadow = sstep(0.585, 0.50, V) * 0.5
    skin_n = np.array([150, 158, 167], F32)[None, None, :] * ((1 - chin_shadow) * (0.84 + 0.2 * n_mid) * (1 - 0.22 * sstep(0.66, 0.78, V)))[..., None]
    L.over(skin_n, a_neck)
    for sgn in (-1, 1):                                 # collarbones, barely
        st = Strands(W, H)
        st.add([((0.5 + sgn * 0.035) * W, 0.668 * H), ((0.5 + sgn * 0.085) * W, 0.655 * H), ((0.5 + sgn * 0.128) * W, 0.642 * H)], 2.2, 1.0)
        L.over((92, 98, 108), blur(st.get(), 1.2) * 0.4 * a_neck)

    face = []
    for t in np.linspace(0, 2 * math.pi, 56, endpoint=False):
        nar = 1 - 0.24 * max(0.0, math.sin(t)) ** 1.5    # narrows to the chin
        face.append(T(0.5 + 0.178 * math.cos(t) * nar, 0.36 + 0.164 * math.sin(t)))
    pen = Pen(W, H)
    pen.poly(face)
    fm = pen.get()
    a_face = sstep(0.2, 0.8, blur(fm, 1.8))
    bx_, by_ = T(0.5, 0.30)
    brow = np.exp(-((xx - bx_) / 34) ** 2 - ((yy - by_) / 22) ** 2)
    f_tone = (0.70 + 0.30 * blur(fm, 12)) * (0.92 + 0.12 * brow) * (0.94 + 0.1 * n_mid)   # falls off to the edge of the face
    ex, ey = 0.066, 0.388
    for sgn in (-1, 1):                                 # sockets
        cx, cy = T(0.5 + sgn * ex, ey - 0.004)
        f_tone *= 1 - 0.46 * np.exp(-((xx - cx) / 12.5) ** 2 - ((yy - cy) / 8.5) ** 2)
    cx, cy = T(0.5, 0.425)                              # under the nose
    f_tone *= 1 - 0.16 * np.exp(-((xx - cx) / 7) ** 2 - ((yy - cy) / 5) ** 2)
    L.over(np.array([152, 160, 170], F32)[None, None, :] * f_tone[..., None], a_face)
    st = Strands(W, H)                                  # a closed mouth
    st.add([T(0.462, 0.4535), T(0.5, 0.4565), T(0.538, 0.4535)], 1.5, 1.5)
    L.over((84, 82, 92), blur(st.get(), 0.9) * 0.55 * a_face)
    cx, cy = T(0.5, 0.476)
    L.over((104, 110, 122), 0.3 * np.exp(-((xx - cx) / 13) ** 2 - ((yy - cy) / 4.5) ** 2) * a_face)

    # the one eye the hair leaves uncovered (viewer's right)
    e_w, e_h = (0.027, 0.0115) if near else (0.025, 0.0095)
    ecx, ecy = T(0.5 + ex, ey)
    pen = Pen(W, H, 4)
    pen.poly([(ecx + e_w * W * math.cos(t), ecy + e_h * H * math.sin(t) * (1.0 if math.sin(t) < 0 else 0.8)) for t in np.linspace(0, 2 * math.pi, 28, endpoint=False)])
    L.over((16, 18, 24), sstep(0.2, 0.8, blur(pen.get(), 0.8)) * 0.92 * a_face)

    # ---- hair: fine locks with gaps; they part round the one eye ------------------------------
    g0, g1 = (0.540, 0.600) if near else (0.546, 0.590)
    st, sheen = Strands(W, H), Strands(W, H)
    for i in range(380):
        side = i >= 190                                 # the first 190 fall over the face, the rest down the sides
        if side:
            sgn = -1 if rr.random() < 0.5 else 1
            ur = 0.5 + sgn * (0.09 + 0.14 * rr.random())
            uf = 0.5 + sgn * (0.165 + 0.085 * rr.random())
        else:
            ur = 0.5 + (rr.random() - 0.5) * 0.40
            uf = 0.5 + (ur - 0.5) * (0.78 + 0.22 * rr.random()) + (rr.random() - 0.5) * 0.035
        cap = math.sqrt(max(0.0, 1 - ((ur - 0.5) / 0.2375) ** 2))
        vr = 0.262 - 0.135 * cap * (0.25 + 0.7 * rr.random())
        sway, vend = (rr.random() - 0.5) * 0.07, (0.62 if side else 0.56) + (0.35 if side else 0.40) * rr.random() ** 0.8
        wd, lite = 1.0 + 1.9 * rr.random() ** 1.7, rr.random()
        ulo = uf + sway * 0.4                           # below the face the lock hangs where it started
        if g0 < uf < g1 and (wd > 1.5 or rr.random() < 0.6):   # pushed aside at eye level only: an almond-shaped opening
            uf = g0 - 0.004 * rr.random() if uf < (g0 + g1) / 2 else g1 + 0.004 * rr.random()
        vm = (0.47 + vend) / 2
        pts = [T(ur, vr), T((ur + uf) / 2 + (ur - 0.5) * 0.10, 0.285), T(uf, 0.39), T((uf + ulo) / 2, 0.47),
               T(ulo, vm, hang(vm)), T(uf + sway, vend, hang(vend))]
        st.add(pts, wd, 0.55, 1.0, 0.4)
        if lite < 0.22:
            sheen.add(pts[:3], 0.9, 0.5, 0.55, 0.0)
    for _ in range(40):                                 # flyaways at the outline
        sgn = -1 if rr.random() < 0.5 else 1
        u0, v0 = 0.5 + sgn * (0.19 + 0.05 * rr.random()), 0.16 + 0.34 * rr.random()
        ln, out = 0.10 + 0.22 * rr.random(), sgn * (0.02 + 0.05 * rr.random())
        st.add([T(u0, v0), T(u0 + out * 0.7, v0 + ln * 0.5, hang(v0 + ln * 0.5)), T(u0 + out, v0 + ln, hang(v0 + ln))], 0.9, 0.5, 0.6, 0.0)
    locks = st.get()

    pen = Pen(W, H)                                     # crown: hair cap with a parting
    capp = [T(0.5 + 0.2375 * math.cos(t), 0.262 + 0.135 * math.sin(t)) for t in np.linspace(math.pi, 2 * math.pi, 30)]
    capp += [T(0.725, 0.31), T(0.665, 0.305), T(0.585, 0.272), T(0.515, 0.240), T(0.43, 0.275), T(0.34, 0.308), T(0.275, 0.31)]
    pen.poly(capp)
    a_cap = sstep(0.25, 0.80, blur(pen.get(), 2.4) + (n_hi - 0.5) * 0.3)

    skin_mask = np.maximum(a_face, a_neck)
    L.over((8, 9, 14), np.clip(blur(shift(np.maximum(locks, a_cap), 2, 3), 3.0) * 0.62, 0, 1) * skin_mask)   # hair shades the face
    L.over((3, 3, 5), a_cap * 0.98)
    L.over((3, 3, 5), np.clip(blur(locks, 0.6) * 1.1, 0, 1))
    crown = np.exp(-((V - 0.215) / 0.045) ** 2)
    L.over((34, 39, 48), blur(sheen.get(), 0.7) * 0.5 * crown)

    # eye glints: one clear, the other only just through the hair (as in the approved version)
    for sgn, rad, al in ((1, 1.9 if near else 1.6, 0.95), (-1, 1.3, 0.42)):
        gx, gy = T(0.5 + sgn * ex - 0.004, ey - 0.002)
        L.over((222, 228, 236), al * np.exp(-((xx - gx) ** 2 + (yy - gy) ** 2) / (2 * (rad * 0.62) ** 2)))

    if near:   # fingers on the inside of the pane (viewer's left, clear of the mullion); the palm stays back in the dark
        pen = Pen(W, H, 3)
        pen.limb([(0.214 * W, 0.87 * H, 0.036 * W), (0.200 * W, 1.03 * H, 0.05 * W)])
        sleeve = sstep(0.2, 0.8, blur(pen.get(), 2.4))
        pen = Pen(W, H, 3)
        pen.poly(ell(0.218 * W, 0.802 * H, 0.043 * W, 0.050 * W))
        tips = [(0.153, 0.668), (0.191, 0.633), (0.232, 0.627), (0.270, 0.652)]
        for (bx, by), (tx, ty) in zip([(0.186, 0.792), (0.207, 0.784), (0.231, 0.784), (0.252, 0.792)], tips):
            pen.limb([(bx * W, by * H, 0.0122 * W), ((bx + tx) / 2 * W, (by + ty) / 2 * H, 0.0106 * W), (tx * W, ty * H, 0.0092 * W)])
        pen.limb([(0.240 * W, 0.822 * H, 0.015 * W), (0.288 * W, 0.788 * H, 0.0118 * W), (0.316 * W, 0.752 * H, 0.0098 * W)])
        tips.append((0.316, 0.752))
        hm = pen.get()
        reach = sstep(0.845, 0.70, V)                                         # 0 at the wrist, 1 along the fingers
        a_hand = sstep(0.2, 0.8, blur(hm, 1.2)) * (0.50 + 0.45 * reach)
        L.over((5, 6, 10), blur(shift(hm, 2, 4), 5) * 0.4)
        L.over(np.array([62, 68, 77], F32)[None, None, :] * (0.8 + 0.3 * folds)[..., None], sleeve * 0.8 * (1 - a_hand))
        h_tone = (0.42 + 0.58 * reach) * (0.82 + 0.2 * blur(hm, 4)) * (0.95 + 0.1 * n_mid)
        L.over(np.array([160, 168, 178], F32)[None, None, :] * h_tone[..., None], a_hand)
        press = np.zeros((H, W), F32)                                         # pads go pale where they press the glass
        for tx, ty in tips:
            press += np.exp(-((xx - tx * W) / 2.6) ** 2 - ((yy - (ty + 0.004) * H) / 3.8) ** 2)
        L.over((214, 221, 230), np.clip(press, 0, 1) * 0.78 * sstep(0.2, 0.8, blur(hm, 1.2)))
        L.over((150, 160, 172), np.clip(blur(press, 7) * 1.6, 0, 1) * 0.10)   # a breath of condensation round them

    L.fade(sstep(0, 3, xx) * sstep(W - 1, W - 4, xx) * sstep(0, 3, yy))
    L.save('woman_near.png' if near else 'woman_far.png', (30, 34, 40), 305 + int(near))


PAINTERS = {
    'woman_far': lambda: paint_woman(False),
    'woman_near': lambda: paint_woman(True),
    'beast_body': paint_beast_body,
    'beast_hand': paint_beast_hand,
    'figure_lean': paint_figure_lean,
    'figure_stand': paint_figure_stand,
    'figure_hand': paint_figure_hand,
}

if __name__ == '__main__':
    for name in (sys.argv[1:] or PAINTERS):
        PAINTERS[name]()
