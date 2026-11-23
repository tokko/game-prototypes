#!/usr/bin/env python3
"""Deterministic painter for the Fogbound Walk round-2 apparition billboards (see SPEC.md).

    python paint_round2.py              # repaint every PNG next to this file
    python paint_round2.py angel_3 sob  # repaint some (a name or a prefix)

Needs Python 3.10+, numpy and Pillow, and the toolkit in ../apparitions/paint_apparitions.py.
All randomness is seeded, so the same numpy/Pillow versions give byte-identical PNGs
(painted with numpy 2.2, Pillow 12.2). Output: straight-alpha sRGB RGBA PNGs.

Paintings are laid out in metres on their plane (x right from the left edge, y up from the
bottom edge) at an isotropic working resolution, then resampled to the texture size. Pale
bodies are built as a small height-field relief (spheres swept along limbs), lit once from
the upper left front, then weathered, fogged at the edges and saved.
"""
import math
import os
import sys

import numpy as np
from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, '..', 'apparitions'))
from paint_apparitions import F32, Layer, Strands, blur, fbm, shift, sstep, warp  # noqa: E402

EMPTY = -1e4
SKIN, CLOTH, HAIR = 1, 2, 3
V3 = lambda *c: np.asarray(c, F32)[None, None, :]


# ---- toolkit --------------------------------------------------------------------------------

class Canvas:
    """A plane of pw x ph metres painted at k px per metre."""

    def __init__(self, pw, ph, k):
        self.pw, self.ph, self.k = pw, ph, k
        self.W, self.H = int(round(pw * k)), int(round(ph * k))
        yy, xx = np.mgrid[0:self.H, 0:self.W].astype(F32)
        self.X, self.Y = xx / k, ph - yy / k

    def px(self, p):
        return p[0] * self.k, (self.ph - p[1]) * self.k

    def noise(self, cell, seed, octaves=4, sx=1.0, sy=1.0):
        return fbm(self.W, self.H, cell * self.k, seed, octaves, sx, sy)

    def gauss(self, p, rx, ry=None, ang=0.0):
        """Soft elliptical spot (1 at p), radii in metres, ang counter-clockwise."""
        ry = rx if ry is None else ry
        c, s = math.cos(math.radians(ang)), math.sin(math.radians(ang))
        dx, dy = self.X - p[0], self.Y - p[1]
        return np.exp(-((dx * c + dy * s) / rx) ** 2 - ((dy * c - dx * s) / ry) ** 2).astype(F32)

    def lines(self, paths, soft=0.0):
        """Mask of tapered strokes. paths: (points in metres, width0, width1[, value0, value1])."""
        st = Strands(self.W, self.H, 2)
        for pts, w0, w1, *v in paths:
            v0, v1 = v if v else (1.0, 1.0)
            st.add([self.px(p) for p in pts], w0 * self.k, w1 * self.k, v0, v1)
        m = st.get()
        return blur(m, soft * self.k) if soft else m

    def edges(self, m=0.05, bottom=None):
        """Alpha falls to zero before every plane edge, so the quad itself can never show."""
        b = m if bottom is None else bottom
        return (sstep(0.0, m, self.X) * sstep(self.pw, self.pw - m, self.X)
                * sstep(self.ph, self.ph - m, self.Y) * sstep(0.0, b, self.Y))


class Relief:
    """Height field (z toward the viewer, in px) with a material id per pixel."""

    def __init__(self, cv):
        self.cv = cv
        self.z = np.full((cv.H, cv.W), EMPTY, F32)
        self.m = np.zeros((cv.H, cv.W), np.uint8)

    def _stamp(self, x, y, rx, ry, ca, sa, z0, rz, mat):
        r = max(rx, ry)
        x0, x1 = max(0, int(x - r - 1)), min(self.cv.W, int(x + r + 2))
        y0, y1 = max(0, int(y - r - 1)), min(self.cv.H, int(y + r + 2))
        if x0 >= x1 or y0 >= y1:
            return
        dx = np.arange(x0, x1, dtype=F32)[None, :] - x
        dy = np.arange(y0, y1, dtype=F32)[:, None] - y
        q = 1 - ((dx * ca + dy * sa) / rx) ** 2 - ((dy * ca - dx * sa) / ry) ** 2
        zz = z0 + rz * np.sqrt(np.maximum(q, 0))
        win = self.z[y0:y1, x0:x1]
        hit = (q > 0) & (zz > win)
        win[hit] = zz[hit]
        self.m[y0:y1, x0:x1][hit] = mat

    def blob(self, p, rx, ry=None, ang=0.0, z=0.0, rz=None, mat=SKIN):
        """Half ellipsoid; radii and depth in metres."""
        k = self.cv.k
        ry = rx if ry is None else ry
        rz = min(rx, ry) if rz is None else rz
        x, y = self.cv.px(p)
        self._stamp(x, y, rx * k, ry * k, math.cos(math.radians(ang)), -math.sin(math.radians(ang)), z * k, rz * k, mat)

    def sweep(self, pts, mat=SKIN, flat=1.0):
        """Spheres swept along a spline through (x, y, radius[, z]) points in metres."""
        k = self.cv.k
        p = np.array([self.cv.px(q) + (q[2] * k, (q[3] if len(q) > 3 else 0.0) * k) for q in pts], float)
        p = np.vstack([p[:1], p, p[-1:]])
        for i in range(1, len(p) - 2):
            p0, p1, p2, p3 = p[i - 1], p[i], p[i + 1], p[i + 2]
            n = max(2, int(np.hypot(*(p2 - p1)[:2]) / max(0.8, 0.14 * min(p1[2], p2[2]))))
            for j in range(n + (i == len(p) - 3)):
                t = j / n
                q = 0.5 * (2 * p1 + (p2 - p0) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t * t
                           + (3 * p1 - p0 - 3 * p2 + p3) * t ** 3)
                r = max(0.5, min(q[2], max(p1[2], p2[2])))
                self._stamp(q[0], q[1], r, r, 1.0, 0.0, q[3], r * flat, mat)

    @property
    def mask(self):
        return (self.z > EMPTY / 2).astype(F32)

    def bump(self, p, rx, ry, amp, ang=0.0):
        """Raise (or, with a negative amp, carve) a soft spot on whatever is already there."""
        self.z += self.cv.gauss(p, rx, ry, ang) * amp * self.cv.k * self.mask

    def emboss(self, m, amp, mat=None):
        on = self.mask if mat is None else (self.m == mat).astype(F32)
        self.z += m * amp * self.cv.k * on

    def light(self, L=(-0.36, -0.60, 0.72), soft=1.5, ao=9.0, wrap=0.35):
        """Returns (lambert, cast shadow, occlusion) for a light toward L (x right, y down, z to the viewer)."""
        k = self.cv.k
        valid = self.z > EMPTY / 2
        zb = np.where(valid, self.z, self.z[valid].min() - 0.03 * k).astype(F32)
        zs = blur(zb, soft)
        gy, gx = np.gradient(zs)
        lam = np.clip(((-gx * L[0] - gy * L[1] + L[2]) / np.sqrt(gx * gx + gy * gy + 1) + wrap) / (1 + wrap), 0, 1)
        hxy = math.hypot(L[0], L[1])
        ux, uy, rise = L[0] / hxy, L[1] / hxy, L[2] / hxy
        sh = np.zeros_like(zs)
        for d in (3, 6, 10, 15, 22, 31, 42, 56):
            sh = np.maximum(sh, sstep(0.0, 0.018 * k, shift(zs, -d * ux, -d * uy) - zs - d * rise))
        occ = np.clip(1 - 1.1 * np.maximum(blur(zs, ao) - zs, 0) / ao, 0.55, 1)
        return lam.astype(F32), blur(sh, 5.0), occ.astype(F32)


def resize(a, w, h):
    return np.asarray(Image.fromarray(np.ascontiguousarray(a, F32)).resize((w, h), Image.LANCZOS), F32)


def save(name, L, size, fill, seed, bend=None, soften=0.0):
    """Bend and soften (optional), resample the premultiplied painting to the texture size and write straight alpha."""
    w, h = size
    chans = [L.c[..., 0], L.c[..., 1], L.c[..., 2], L.a]
    if bend is not None:
        chans = [warp(c, bend[0], bend[1]) for c in chans]
    if soften:
        chans = [blur(c, soften) for c in chans]
    if chans[3].shape != (h, w):
        chans = [resize(c, w, h) for c in chans]
    yy, xx = np.mgrid[0:h, 0:w]
    rim = np.clip(np.minimum(np.minimum(xx, w - 1 - xx), np.minimum(yy, h - 1 - yy)) / 3.0, 0, 1).astype(F32)   # the border itself is always clear
    c, a = np.clip(np.stack(chans[:3], -1), 0, 255) * rim[..., None], np.clip(chans[3], 0, 1) * rim
    ca = blur(a, 4)
    cc = np.stack([blur(c[..., i], 4) for i in range(3)], -1)
    solid = c / np.maximum(a, 1e-4)[..., None]
    bleed = cc / np.maximum(ca, 1e-5)[..., None]          # colour carried a little past the edge (no fringes)
    rgb = np.where((a > 0.03)[..., None], solid, np.where((ca > 0.004)[..., None], bleed, np.asarray(fill, F32)[None, None, :]))
    r = np.random.default_rng(seed)
    a8 = a * 255 + (r.random(a.shape, dtype=F32) - 0.5)   # dither: faint haze must not band
    a8 = np.where(a * 255 < 0.6, 0, a8)
    out = np.dstack([np.clip(np.rint(rgb), 0, 255), np.clip(np.rint(a8), 0, 255)]).astype(np.uint8)
    out[out[..., 3] == 0, :3] = np.asarray(fill, np.uint8)
    path = os.path.join(HERE, name)
    Image.fromarray(out, 'RGBA').save(path, optimize=True)
    print(f'{name}: {w}x{h}, {os.path.getsize(path) / 1024:.0f} KB')



def hand(R, wrist, tip, z0, z1, width=0.078, r=0.0098, fan=0.09, bow=0.0, thumb=1, lens=(0.88, 1.0, 0.95, 0.78), mat=SKIN):
    """A long hand from wrist to the middle fingertip: flat palm, four fingers, a thumb on side `thumb` (+1/-1, 0 = none)."""
    wx, wy = wrist
    ln = math.hypot(tip[0] - wx, tip[1] - wy)
    dx, dy = (tip[0] - wx) / ln, (tip[1] - wy) / ln
    qx, qy = -dy, dx                                         # across the hand
    at = lambda a, b: (wx + dx * a + qx * b, wy + dy * a + qy * b)
    zk = z0 + (z1 - z0) * 0.45
    R.sweep([at(0, 0) + (0.023, z0), at(0.2 * ln, 0) + (width * 0.43, z0), at(0.41 * ln, 0) + (width * 0.48, zk)], mat, 0.45)
    for i, f in enumerate(lens):
        o = (i - 1.5) / 1.5
        b = o * (width / 2 - r)
        a = fan * o
        fl = ln * 0.56 * f
        ex, ey = math.cos(a) * fl, math.sin(a) * fl
        R.sweep([at(0.44 * ln, b) + (r * 1.1, zk), at(0.44 * ln + ex * 0.5, b + ey * 0.5 + bow * fl) + (r, (zk + z1) / 2),
                 at(0.44 * ln + ex, b + ey + bow * fl * 0.4) + (r * 0.74, z1)], mat, 0.8)
    if thumb:
        b = thumb * (width / 2 - r * 0.4)
        R.sweep([at(0.10 * ln, b * 0.8) + (r * 1.35, z0), at(0.28 * ln, b * 1.35) + (r * 1.15, zk), at(0.45 * ln, b * 1.45) + (r * 0.8, zk)], mat, 0.8)


# ---- 1. the statue that is not where it was -------------------------------------------------
# 0.9 x 2.0 m, ground line at the bottom edge. One entity in four poses: about 1.9 m, narrow, a long neck.
# Lit from the upper left front in every pose (cold, neutral), so the poses can be swapped without the light jumping.

def a_head(R, c, s=1.0, roll=0.0, yaw=0.0, z=0.05, bow=0.0, lids=True, hair=True):
    """Head at c (centre of the skull). yaw -1..1 turns the face toward +x; returns the feature positions."""
    cv = R.cv
    cr, sr = math.cos(math.radians(roll)), math.sin(math.radians(roll))
    at = lambda u, v: (c[0] + s * (u * cr - v * sr), c[1] + s * (u * sr + v * cr))
    if hair:
        R.blob(at(-yaw * 0.020, 0.018), s * 0.088, s * 0.102, roll, z - 0.02 * s, s * 0.10, HAIR)   # hair, bound back
    R.blob(at(0, 0.005), s * 0.077, s * 0.095, roll, z, s * 0.09, SKIN)
    R.sweep([at(yaw * 0.010, -0.040) + (s * 0.063, z + 0.012 * s), at(yaw * 0.020, -0.088) + (s * 0.044, z + 0.020 * s),
             at(yaw * 0.026, -0.114) + (s * 0.028, z + 0.022 * s)], SKIN, 0.85)                      # a long jaw
    U = ((cv.X - c[0]) * cr + (cv.Y - c[1]) * sr) / s
    V = ((cv.Y - c[1]) * cr - (cv.X - c[0]) * sr) / s
    du = np.abs(U - yaw * 0.030)
    cap = ((U / 0.10) ** 2 + (V / 0.115) ** 2 < 1) & (R.m == SKIN) & (V > 0.066 - 0.05 * bow - 0.25 * du - 5.0 * du * du)
    if hair:
        R.m[cap] = HAIR                                                                             # drawn back from a centre parting
        R.z += blur(cap.astype(F32), 0.004 * cv.k) * 0.004 * cv.k * s
    for sg in (-1, 1) if hair else ():                                                              # and down over the ears to the nape
        thin = 1 - 0.6 * max(0.0, sg * yaw)
        wide = 1 + 0.35 * max(0.0, -sg * yaw)
        R.sweep([at(sg * 0.018 + yaw * 0.02, 0.094) + (s * 0.020 * thin, z + 0.050 * s),
                 at(sg * 0.060 * wide + yaw * 0.012, 0.060) + (s * 0.025 * thin * wide, z + 0.046 * s),
                 at(sg * 0.076 * wide, 0.000) + (s * 0.024 * thin * wide, z + 0.036 * s),
                 at(sg * 0.068 * wide, -0.060) + (s * 0.019 * thin, z + 0.022 * s),
                 at(sg * 0.046 * wide, -0.100) + (s * 0.012 * thin, z + 0.006 * s)], HAIR, 0.6)
    fx = yaw * 0.034
    mx = fx + yaw * 0.008
    f = {'s': s, 'roll': roll, 'mouth': at(mx, -0.095), 'c': c}
    for sg in (-1, 1):
        far = max(0.0, sg * yaw)
        ex, erx = fx + sg * 0.031 * (1 - 0.35 * far), 0.018 * (1 - 0.4 * far)
        R.bump(at(fx + sg * 0.030 * (1 - 0.3 * far), 0.003), s * 0.027 * (1 - 0.35 * far), s * 0.008, 0.005 * s, roll)   # brow
        R.bump(at(ex, -0.020), s * erx, s * 0.011, -0.011 * s, roll)                                 # socket
        if lids:
            R.bump(at(ex, -0.022), s * erx * 0.55, s * 0.0055, 0.004 * s, roll)                      # a closed lid
        R.bump(at(fx + sg * 0.043 * (1 - 0.3 * far), -0.050), s * 0.020, s * 0.014, 0.004 * s, roll)  # cheekbone
        R.bump(at(fx + sg * 0.041 * (1 - 0.3 * far), -0.088), s * 0.016, s * 0.022, -0.005 * s, roll)  # hollow cheek
        f['eye%d' % sg] = (at(ex, -0.021), erx)
    R.bump(at(fx + yaw * 0.006, -0.034), s * 0.0105, s * 0.028, 0.008 * s, roll)                     # nose
    R.bump(at(fx + yaw * 0.013, -0.060), s * 0.012, s * 0.009, 0.008 * s, roll)
    R.bump(at(fx + yaw * 0.012, -0.073), s * 0.012, s * 0.005, -0.004 * s, roll)
    R.bump(at(mx, -0.087), s * 0.018, s * 0.005, 0.003 * s, roll)                                    # lips
    R.bump(at(mx, -0.094), s * 0.020, s * 0.0035, -0.004 * s, roll)
    R.bump(at(mx, -0.102), s * 0.015, s * 0.006, 0.004 * s, roll)
    R.bump(at(mx, -0.122), s * 0.017, s * 0.011, 0.005 * s, roll)                                    # chin
    return f


def a_arm(R, sh, el, wr, zs, s=1.0):
    lerp = lambda a, b, t: (a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t)
    zm = lambda i, t: zs[i] + (zs[i + 1] - zs[i]) * t
    R.sweep([sh + (0.045 * s, zs[0]), lerp(sh, el, 0.45) + (0.036 * s, zm(0, 0.45)), el + (0.029 * s, zs[1])], SKIN, 0.85)
    R.sweep([el + (0.030 * s, zs[1]), lerp(el, wr, 0.3) + (0.033 * s, zm(1, 0.3)), wr + (0.0215 * s, zs[2])], SKIN, 0.85)


def a_gown(R, spine, flat=0.55, z=0.0):
    """The gown as one column through (x, y, half-width) points, top to hem."""
    R.sweep([(x, y, r, z) for x, y, r in spine], CLOTH, flat)


def a_front(R, lean=0.0):
    """Gown, shoulders and neck, square to the viewer."""
    a_gown(R, [(0.45, 1.50, 0.128), (0.45, 1.27, 0.106), (0.455 + lean, 1.03, 0.136), (0.452 + lean, 0.55, 0.150), (0.455 + lean, 0.12, 0.185)])
    R.sweep([(0.278, 1.56, 0.046, 0.0), (0.45, 1.59, 0.060, 0.012), (0.622, 1.56, 0.046, 0.0)], SKIN, 0.8)
    R.sweep([(0.45, 1.60, 0.042, 0.02), (0.452, 1.69, 0.038, 0.03)], SKIN)
    for sg in (-1, 1):
        R.bump((0.45 + sg * 0.058, 1.40), 0.050, 0.045, 0.012)


A_NECK = [([(0.34, 1.52), (0.45, 1.455), (0.56, 1.52)], 0.010, 0.010)]
A_CORD = [([(0.34, 1.225), (0.45, 1.21), (0.56, 1.225)], 0.014, 0.014)]
A_BONES = [([(0.44, 1.575), (0.36, 1.595), (0.30, 1.59)], 0.010, 0.006), ([(0.46, 1.575), (0.54, 1.595), (0.60, 1.59)], 0.010, 0.006)]


def a_hang(x0, x1, y0, y1, n, rr, spread=1.45):
    """n long folds falling from the waist to the hem between x0 and x1."""
    out = []
    for i in range(n):
        t = (i + 0.5 + (rr.random() - 0.5) * 0.7) / n
        xa, w = x0 + (x1 - x0) * t, 0.012 + 0.014 * rr.random()
        xb = (x0 + x1) / 2 + (xa - (x0 + x1) / 2) * spread
        out.append(([(xa, y0 - 0.25 * rr.random() ** 2), ((xa + xb) / 2 + (rr.random() - 0.5) * 0.03, (y0 + y1) / 2), (xb, y1)], w, w * 2.6))
    return out


def a_finish(name, cv, R, seed, face=None, eyes=0.0, mouth=0.0, folds=(), bones=A_BONES, fold_amp=0.024):
    """Light, weather and fog the relief; write the PNG."""
    X, Y, k = cv.X, cv.Y, cv.k
    n_lo, n_mid, n_hi = cv.noise(0.30, seed), cv.noise(0.075, seed + 1), cv.noise(0.018, seed + 2, 3)
    n_str = cv.noise(0.10, seed + 3, 3, sx=0.22, sy=5.0)
    n_drip = cv.noise(0.22, seed + 4, 3, sx=0.16, sy=3.0)
    n_fold = cv.noise(0.40, seed + 10, 3, sx=0.22, sy=4.0)
    R.emboss((1 - np.abs(2 * n_fold - 1)) - 0.5, 0.006 + 0.010 * sstep(1.3, 0.2, Y), CLOTH)         # general drapery
    if folds:
        R.emboss(cv.lines(folds, 0.010) - 0.25, fold_amp, CLOTH)
    if bones:
        R.emboss(cv.lines(bones, 0.006), 0.005, SKIN)
    R.emboss(cv.noise(0.03, seed + 5, 3, sx=0.3, sy=2.5) - 0.5, 0.007, HAIR)                         # carved hair
    R.emboss(n_hi - 0.5, 0.0025)                                                                    # pitted surface
    lam, sh, occ = R.light()
    mask = R.mask
    alb = np.where((R.m == HAIR)[..., None], V3(146, 150, 150), np.where((R.m == CLOTH)[..., None], V3(170, 173, 172), V3(188, 186, 180)))
    col = alb * (V3(0.22, 0.255, 0.31) + V3(1.0, 0.985, 0.95) * (lam * (1 - 0.5 * sh))[..., None] * 0.92) * occ[..., None]
    col *= (0.84 + 0.30 * n_mid)[..., None]
    drips = sstep(0.50, 0.80, n_drip) * (0.25 + 0.75 * sstep(0.35, 0.75, n_lo))                       # rain marks
    if face:                                                                                        # the face is spared
        drips *= 1 - 0.8 * cv.gauss(face['c'], 0.12 * face['s'])
    col *= (1 - 0.30 * drips)[..., None]
    lichen = sstep(0.60, 0.74, cv.noise(0.11, seed + 6)) * sstep(0.45, 0.7, n_mid)
    col = col * (1 - lichen[..., None] * 0.5) + col * V3(0.62, 0.70, 0.60) * lichen[..., None] * 0.5
    col *= (0.56 + 0.44 * sstep(0.05, 1.45, Y))[..., None]                                          # the dark takes the lower half
    if face:
        s = face['s']
        for key in ('eye-1', 'eye1'):
            p, erx = face[key]
            hollow = np.clip(cv.gauss(p, s * erx * 0.86, s * 0.0090, face['roll']) * 1.1, 0, 1) * eyes
            col = col * (1 - hollow[..., None]) + V3(12, 13, 18) * hollow[..., None]
        if mouth:
            gap = np.clip(cv.gauss(face['mouth'], s * 0.0125, s * 0.0075 * mouth, face['roll']) * 1.2, 0, 1) * 0.88
            col = col * (1 - gap[..., None]) + V3(10, 10, 14) * gap[..., None]

    a = sstep(0.28, 0.74, blur(mask, 0.0045 * k) + (n_hi - 0.5) * 0.24) * (0.90 + 0.08 * n_lo)
    a *= 0.25 + 0.75 * sstep(0.0, 0.55, n_str * 0.55 + n_mid * 0.3 + (Y - 0.04) * 3.2)                # the hem is not all there
    a *= 1 - 0.30 * sstep(0.58, 0.82, cv.noise(0.22, seed + 11)) * sstep(1.5, 0.9, Y)                 # nor is all of the rest
    haze = sstep(0.05, 0.8, blur(mask, 0.028 * k) * (0.45 + 0.9 * n_mid)) * 0.13                      # a breath of fog on it
    mist = np.exp(-((X - cv.pw / 2) / 0.30) ** 2 - ((Y - 0.10) / 0.16) ** 2) * (0.35 + 0.65 * n_mid) * 0.36

    L = Layer(cv.W, cv.H)
    L.over((96, 104, 116), haze)
    L.over(col, a)
    L.over((46, 54, 66), mist * sstep(0.0, 0.6, blur(mask, 0.05 * k) + 0.25))
    L.fade(cv.edges(0.04, 0.02))
    bend = ((cv.noise(0.20, seed + 7, 3) - 0.5) * 0.010 * k, (cv.noise(0.20, seed + 8, 3) - 0.5) * 0.010 * k)
    save(name, L, (512, 1024), (60, 64, 70), seed + 9, bend, soften=0.9)


def paint_angel_0():
    """Far: standing square to the viewer, head bowed, face hidden in its hands."""
    cv = Canvas(0.9, 2.0, 640)
    R = Relief(cv)
    a_front(R)
    a_head(R, (0.455, 1.762), 1.0, roll=-6, bow=1.0)
    a_arm(R, (0.278, 1.555), (0.325, 1.275), (0.415, 1.56), (0.02, 0.10, 0.16))
    a_arm(R, (0.622, 1.555), (0.574, 1.272), (0.494, 1.565), (0.02, 0.10, 0.16))
    hand(R, (0.415, 1.56), (0.434, 1.792), 0.16, 0.175, thumb=1, fan=0.07, bow=-0.04)
    hand(R, (0.494, 1.565), (0.481, 1.798), 0.162, 0.18, thumb=-1, fan=0.07, bow=0.04)
    folds = a_hang(0.35, 0.56, 1.20, 0.08, 6, np.random.default_rng(401)) + A_CORD + A_NECK
    a_finish('angel_0.png', cv, R, 400, folds=folds)


def paint_angel_1():
    """Caught mid-stride, walking past to the right; the head has come round over its shoulder to look back."""
    cv = Canvas(0.9, 2.0, 640)
    R = Relief(cv)
    xb = lambda y: 0.44 - 0.165 * float(sstep(1.0, 0.14, y)) ** 1.2          # back leg
    xf = lambda y: 0.47 + 0.195 * float(sstep(1.0, 0.10, y))                 # front leg
    for y in np.linspace(0.98, 0.13, 30):                                    # the gown pulled tight between the legs
        R.sweep([(xb(y), y, 0.045, -0.03), (xf(y), y, 0.045, -0.03)], CLOTH, 0.5)
    a_arm(R, (0.515, 1.54), (0.635, 1.30), (0.725, 1.085), (-0.06, -0.06, -0.05))                                    # far arm, swung forward
    hand(R, (0.725, 1.085), (0.775, 0.895), -0.05, -0.05, thumb=1, fan=0.07, bow=0.06)
    R.sweep([(0.475, 1.52, 0.088, 0.0), (0.465, 1.30, 0.080, 0.0), (0.452, 1.05, 0.100, 0.0)], CLOTH, 0.85)          # the body in profile
    R.bump((0.515, 1.41), 0.05, 0.06, 0.02)
    R.blob((0.402, 1.00), 0.068, 0.095, 0, 0.0, 0.05, CLOTH)
    R.sweep([(0.44, 1.02, 0.090, -0.02), (xb(0.56) + 0.01, 0.56, 0.062, -0.02), (xb(0.16), 0.16, 0.044, -0.02)], CLOTH, 0.7)
    R.sweep([(0.47, 1.02, 0.090, 0.03), (xf(0.56), 0.56, 0.064, 0.04), (xf(0.11), 0.11, 0.047, 0.04)], CLOTH, 0.7)
    R.sweep([(xf(0.08), 0.065, 0.030, 0.04), (0.755, 0.04, 0.021, 0.04)], SKIN, 0.8)                                  # feet
    R.sweep([(xb(0.14), 0.12, 0.027, -0.02), (0.262, 0.045, 0.019, -0.02)], SKIN, 0.8)
    R.sweep([(0.435, 1.565, 0.050, 0.02), (0.495, 1.575, 0.050, 0.02)], SKIN, 0.8)
    R.sweep([(0.478, 1.60, 0.040, 0.02), (0.488, 1.69, 0.037, 0.03)], SKIN)
    f = a_head(R, (0.492, 1.768), 1.0, roll=9, yaw=-0.6, z=0.05, lids=False)
    a_arm(R, (0.455, 1.55), (0.37, 1.275), (0.30, 1.02), (0.06, 0.07, 0.07))                                        # near arm, swung back
    hand(R, (0.30, 1.02), (0.262, 0.828), 0.07, 0.07, thumb=1, fan=0.07, bow=-0.06)
    rr = np.random.default_rng(411)
    folds = [([(0.48 + 0.02 * i, 1.02), (xf(0.56) - 0.03 + 0.03 * i, 0.56), (xf(0.12) - 0.03 + 0.03 * i, 0.12)], 0.014, 0.022) for i in range(3)]
    folds += [([(0.43 - 0.015 * i, 1.02), (xb(0.56) + 0.03 - 0.02 * i, 0.56), (xb(0.16) + 0.03 - 0.02 * i, 0.16)], 0.014, 0.022) for i in range(3)]
    folds += [([(xb(y) + 0.02, y + 0.10), ((xb(y) + xf(y)) / 2, y - 0.05 * rr.random()), (xf(y) - 0.02, y + 0.10)], 0.016, 0.016) for y in (0.72, 0.50, 0.30)]
    folds += [([(0.375, 1.215), (0.46, 1.20), (0.55, 1.22)], 0.014, 0.014)]
    a_finish('angel_1.png', cv, R, 410, f, eyes=0.45, folds=folds, bones=None)


def paint_angel_2():
    """Nearer: one arm held out toward the viewer; the head has gone over much too far."""
    cv = Canvas(0.9, 2.0, 640)
    R = Relief(cv)
    a_front(R, -0.006)
    R.sweep([(0.446, 1.65, 0.039, 0.03), (0.432, 1.69, 0.037, 0.04)], SKIN)
    f = a_head(R, (0.377, 1.737), 1.0, roll=50, yaw=0.1, z=0.05)
    a_arm(R, (0.278, 1.555), (0.262, 1.225), (0.258, 0.925), (0.03, 0.04, 0.05))
    hand(R, (0.258, 0.925), (0.262, 0.72), 0.05, 0.05, thumb=1, fan=0.06, bow=-0.03)
    a_arm(R, (0.622, 1.555), (0.705, 1.43), (0.775, 1.395), (0.03, 0.18, 0.36), s=1.07)
    hand(R, (0.775, 1.395), (0.838, 1.275), 0.37, 0.43, width=0.088, r=0.011, fan=0.20, bow=0.10, thumb=1)
    folds = a_hang(0.35, 0.55, 1.20, 0.08, 6, np.random.default_rng(421)) + A_CORD + A_NECK
    a_finish('angel_2.png', cv, R, 420, f, eyes=0.4, folds=folds)


def paint_angel_3():
    """Closest: bent toward the viewer, face half-turned, eyes hollow, the mouth a little open."""
    cv = Canvas(0.9, 2.0, 640)
    R = Relief(cv)
    a_gown(R, [(0.45, 1.46, 0.135), (0.45, 1.25, 0.108), (0.452, 1.03, 0.132), (0.452, 0.55, 0.146), (0.455, 0.12, 0.180)], z=-0.05)
    R.sweep([(0.270, 1.500, 0.048, 0.05), (0.35, 1.545, 0.056, 0.07), (0.45, 1.565, 0.064, 0.07), (0.55, 1.535, 0.056, 0.07), (0.630, 1.475, 0.048, 0.05)], SKIN, 0.8)      # shoulders rolled forward
    R.sweep([(0.452, 1.555, 0.046, 0.10), (0.458, 1.59, 0.045, 0.16)], SKIN)
    for sg in (-1, 1):
        R.bump((0.45 + sg * 0.058, 1.37), 0.050, 0.045, 0.010)
    f = a_head(R, (0.458, 1.588), 1.2, roll=-10, yaw=0.45, z=0.20, lids=False)
    a_arm(R, (0.270, 1.490), (0.240, 1.18), (0.250, 0.895), (0.06, 0.10, 0.14), s=1.06)
    hand(R, (0.250, 0.895), (0.258, 0.68), 0.14, 0.16, width=0.083, r=0.0104, thumb=1, fan=0.09, bow=-0.04)
    a_arm(R, (0.630, 1.465), (0.668, 1.16), (0.652, 0.875), (0.06, 0.11, 0.17), s=1.06)
    hand(R, (0.652, 0.875), (0.636, 0.662), 0.17, 0.20, width=0.084, r=0.0105, thumb=-1, fan=0.11, bow=0.06)
    folds = a_hang(0.35, 0.55, 1.18, 0.08, 6, np.random.default_rng(431)) + [([(0.345, 1.205), (0.45, 1.19), (0.555, 1.205)], 0.014, 0.014)]
    a_finish('angel_3.png', cv, R, 430, f, eyes=0.85, mouth=1.0, folds=folds, bones=None)


# ---- pale flesh: shared by the women and the crossers -----------------------------------------

def shade(cv, R, seed, alb, L=(-0.36, -0.60, 0.72), amb=(0.20, 0.235, 0.29), cast=0.5, mottle=0.18, edge=0.0045):
    """Light the relief. alb maps material -> sRGB; returns (colour, soft alpha)."""
    n_mid, n_hi = cv.noise(0.075, seed + 1), cv.noise(0.018, seed + 2, 3)
    R.emboss(n_hi - 0.5, 0.002)
    lam, sh, occ = R.light(L)
    albedo = np.zeros((cv.H, cv.W, 3), F32)
    for mat, c in alb.items():
        albedo[R.m == mat] = c
    col = albedo * (V3(*amb) + V3(1.0, 0.985, 0.95) * (lam * (1 - cast * sh))[..., None] * 0.92) * occ[..., None]
    col *= (1 - mottle / 2 + mottle * n_mid)[..., None]
    a = sstep(0.28, 0.74, blur(R.mask, edge * cv.k) + (n_hi - 0.5) * 0.24)
    return col, a


def limb(R, a, b, r0, r1, z0=0.0, z1=0.0, belly=1.12, mat=SKIN, flat=0.85):
    """One thin straight bone from a to b: a little fuller a third of the way along."""
    R.sweep([a + (r0, z0), (a[0] + (b[0] - a[0]) * 0.33, a[1] + (b[1] - a[1]) * 0.33, (r0 * 0.67 + r1 * 0.33) * belly, z0 + (z1 - z0) * 0.33),
             b + (r1, z1)], mat, flat)


# ---- 2. the woman in the corner of the ceiling ----------------------------------------------
# 1.3 x 1.3 m, seen from below and in front; the corner is at the top centre, the floor is down.
# Lit from below (the room's lamp is under her).

def paint_ceiling_woman():
    cv = Canvas(1.3, 1.3, 520)
    X, Y, k = cv.X, cv.Y, cv.k
    R = Relief(cv)
    rr = np.random.default_rng(501)
    # legs, folded up and out: knees above the shoulders, feet braced on the two walls
    for sg, kn, ft in ((-1, (0.300, 1.140), (0.250, 0.790)), (1, (1.020, 1.085), (1.062, 0.725))):
        hip = (0.65 + sg * 0.09, 1.10)
        limb(R, hip, kn, 0.054, 0.032, -0.06, -0.04)
        limb(R, kn, ft, 0.033, 0.020, -0.04, -0.02)
        R.blob(kn, 0.041, 0.041, 0, -0.04, 0.036)
        R.sweep([ft + (0.022, -0.02), (ft[0] + sg * 0.045, ft[1] - 0.055, 0.026, -0.01), (ft[0] + sg * 0.092, ft[1] - 0.092, 0.015, 0.0)], SKIN, 0.6)
    R.sweep([(0.65, 1.13, 0.115, -0.05), (0.648, 1.03, 0.150, -0.02), (0.648, 0.94, 0.172, 0.0)], CLOTH, 0.6)   # the body, seen from under: hips far, chest near
    R.sweep([(0.480, 0.885, 0.046, 0.05), (0.648, 0.862, 0.056, 0.07), (0.816, 0.892, 0.046, 0.05)], CLOTH, 0.8)
    # arms: elbows out, forearms straight down, long hands hanging either side of the head
    for sg, el, wr, tip in ((-1, (0.360, 0.935), (0.408, 0.628), (0.420, 0.402)), (1, (0.942, 0.990), (0.902, 0.690), (0.884, 0.462))):
        sh = (0.648 + sg * 0.168, 0.888)
        limb(R, sh, el, 0.039, 0.026, 0.05, 0.10)
        limb(R, el, wr, 0.028, 0.018, 0.10, 0.16)
        R.blob(el, 0.034, 0.034, 0, 0.10, 0.03)
        hand(R, wr, tip, 0.16, 0.19, width=0.076, r=0.0092, fan=0.20, bow=sg * 0.05, thumb=-sg)
    R.sweep([(0.648, 0.865, 0.040, 0.10), (0.645, 0.80, 0.039, 0.14)], SKIN)
    hc, tilt = (0.640, 0.705), 14.0
    f = a_head(R, hc, 1.0, roll=tilt, z=0.16, lids=False, hair=False)
    R.emboss(cv.lines([([(0.56 + 0.18 * t, 1.16), (0.52 + 0.26 * t + (rr.random() - 0.5) * 0.04, 1.02), (0.49 + 0.32 * t, 0.86)], 0.010, 0.022)
                       for t in np.linspace(0.05, 0.95, 7)], 0.010) - 0.25, 0.013, CLOTH)

    col, a = shade(cv, R, 500, {SKIN: (198, 199, 197), CLOTH: (138, 141, 142)}, L=(0.12, 0.52, 0.84), amb=(0.17, 0.20, 0.25), cast=0.35)
    col *= (0.30 + 0.70 * sstep(1.20, 0.72, Y))[..., None]                                    # she goes up into the dark of the corner
    n_lo, n_mid, n_hi = cv.noise(0.30, 502), cv.noise(0.075, 503), cv.noise(0.018, 504, 3)
    a *= (0.90 + 0.08 * n_lo) * (0.35 + 0.65 * sstep(1.26, 1.02, Y + (n_mid - 0.5) * 0.12))

    # the face: one open eye, the other lost under the hair
    cr, sr = math.cos(math.radians(tilt)), math.sin(math.radians(tilt))
    T = lambda u, v: (hc[0] + u * cr - v * sr, hc[1] + u * sr + v * cr)
    eye = T(0.031, -0.021)
    lid = np.clip(cv.gauss(eye, 0.0165, 0.0098, tilt) * 1.5, 0, 1)
    col = col * (1 - lid[..., None] * 0.93) + V3(14, 15, 20) * lid[..., None] * 0.93
    oth = cv.gauss(T(-0.031, -0.021), 0.015, 0.009, tilt)
    col = col * (1 - oth[..., None] * 0.7) + V3(16, 17, 22) * oth[..., None] * 0.7
    mth = cv.gauss(T(0.0, -0.095), 0.017, 0.0032, tilt)
    col = col * (1 - mth[..., None] * 0.6) + V3(40, 36, 40) * mth[..., None] * 0.6

    # hair: straight down, whatever way the head is turned
    hang = lambda y: float(sstep(hc[1] - 0.16, hc[1] + 0.02, y))                             # follows the head near the scalp only
    def H(u, v):
        w = hang(hc[1] + v)
        px, py = T(u, v)
        return (hc[0] + u) * (1 - w) + px * w, (hc[1] + v) * (1 - w) + py * w
    paths, sheen = [], []
    g0, g1 = -0.004, 0.062                                                                  # the parting her eye looks through
    for i in range(330):
        side = i >= 110
        if side:
            sg = -1 if rr.random() < 0.5 else 1
            ur, uf = sg * (0.035 + 0.05 * rr.random()), sg * (0.078 + 0.035 * rr.random())
        else:
            ur = (rr.random() - 0.5) * 0.15
            uf = ur * (0.80 + 0.2 * rr.random()) + (rr.random() - 0.5) * 0.014
        capv = math.sqrt(max(0.0, 1 - (ur / 0.088) ** 2))
        vr = 0.02 + 0.085 * capv * (0.3 + 0.7 * rr.random())
        wd = 0.0020 + 0.0036 * rr.random() ** 1.7
        ulo = uf + (rr.random() - 0.5) * 0.02
        if g0 < uf < g1 and (wd > 0.003 or rr.random() < 0.7):
            uf = g0 - 0.003 * rr.random() if uf < (g0 + g1) / 2 else g1 + 0.003 * rr.random()
        vend = -0.20 - 0.42 * rr.random() ** 0.7
        sway = (rr.random() - 0.5) * 0.035
        pts = [H(ur, vr), H((ur + uf) / 2 + ur * 0.1, 0.035), H(uf, -0.021), H((uf + ulo) / 2, -0.09), H(ulo, (vend - 0.09) / 2), H(ulo + sway, vend)]
        paths.append((pts, wd, 0.0011, 1.0, 0.35))
        if rr.random() < 0.30:
            sheen.append((pts[2:], 0.0016, 0.0009, 0.65, 0.25))
    locks = cv.lines(paths)
    pen_cap = cv.gauss(T(0.0, 0.058), 0.094, 0.062, tilt)
    a_cap = sstep(0.42, 0.62, pen_cap + (n_hi - 0.5) * 0.12) * a
    fall = cv.lines([([H(0.0, 0.02), H(0.0, -0.25), H(0.0, -0.52)], 0.16, 0.10, 1.0, 0.0)], 0.03) * (0.5 + 0.8 * cv.noise(0.05, 505, 3, sx=0.25, sy=4.0))
    fall *= 1 - 0.92 * cv.gauss(T(0.004, -0.045), 0.062, 0.085, tilt)                          # the face stays clear of the mass
    a_fall = np.clip(fall, 0, 1) * 0.55 * sstep(hc[1] - 0.60, hc[1] - 0.20, Y) ** 0.6

    solid = np.maximum(R.mask, np.clip(locks * 2, 0, 1))
    smoke = sstep(0.08, 0.8, blur(solid, 0.045 * k) * (0.4 + 1.0 * n_mid))
    L = Layer(cv.W, cv.H)
    L.over((7, 9, 13), smoke * 0.50 * sstep(0.55, 1.05, Y))                                   # the dark she sits in
    L.over((70, 80, 94), smoke * 0.10 * sstep(0.95, 0.45, Y))                                 # lamp-lit air under her: the hair shows against it
    L.over(col, a)
    L.over((8, 9, 14), np.clip(blur(shift(np.maximum(locks, a_cap), 0, -3), 3.0) * 0.6, 0, 1) * a)   # hair shades the face (from below)
    L.over((4, 4, 7), a_fall)
    L.over((4, 4, 7), a_cap * 0.97)
    L.over((4, 4, 7), np.clip(blur(locks, 0.6) * 1.15, 0, 1))
    L.over((52, 60, 72), cv.lines(sheen, 0.0012) * 0.55)
    gx, gy = T(0.031 - 0.004, -0.021 + 0.002)
    L.over((226, 232, 240), 0.95 * cv.gauss((gx, gy), 0.0030, 0.0030))
    L.fade(cv.edges(0.06))
    bend = ((cv.noise(0.25, 506, 3) - 0.5) * 0.008 * k, (cv.noise(0.25, 507, 3) - 0.5) * 0.008 * k)
    save('ceiling_woman.png', L, (512, 512), (40, 44, 50), 508, bend, soften=0.6)


# ---- 3. the woman sobbing on the floor ------------------------------------------------------
# 1.0 x 1.0 m, floor at the bottom edge, seen from behind. Two frames that differ only in the head and neck:
# the body (and the hair lying down her back) is painted once, on its own relief, so every pixel outside the
# head is the same in both files.

SOB_LIGHT = (-0.26, -0.52, 0.81)
SOB_HAIR = (5, 5, 8)


def sob_body(cv):
    X, Y = cv.X, cv.Y
    R = Relief(cv)
    rr = np.random.default_rng(601)
    R.sweep([(0.265, 0.085, 0.066, -0.03), (0.50, 0.105, 0.100, -0.02), (0.740, 0.080, 0.062, -0.03)], CLOTH, 0.5)   # the gown lying round her
    for sg, el in ((-1, (0.300, 0.378)), (1, (0.706, 0.388))):
        sh = (0.50 + sg * 0.140, 0.590)
        limb(R, el, (0.50 + sg * 0.07, 0.27), 0.027, 0.022, -0.06, -0.14)                                          # forearms go round her knees
        limb(R, sh, el, 0.037, 0.026, -0.01, -0.02)
        R.blob(el, 0.027, 0.027, 0, -0.02, 0.022)
    R.sweep([(0.50, 0.19, 0.165, 0.0), (0.498, 0.36, 0.118, 0.01), (0.50, 0.50, 0.135, 0.0), (0.50, 0.580, 0.122, -0.03)], CLOTH, 0.6)
    dx = X - 0.50
    bare = (R.m == CLOTH) & (Y > 0.455 + 8.0 * dx * dx) & ~((np.abs(dx) > 0.074) & (np.abs(dx) < 0.090))       # a low back, two thin straps
    R.m[bare] = SKIN
    R.z -= blur(bare.astype(F32), 0.004 * cv.k) * 0.004 * cv.k
    R.sweep([(0.366, 0.596, 0.040, -0.02), (0.50, 0.616, 0.046, -0.04), (0.634, 0.592, 0.040, -0.02)], SKIN, 0.8)   # shoulders, drawn up
    for i, (ln, dy) in enumerate(((0.050, 0.004), (0.062, 0.0), (0.058, -0.003), (0.044, -0.004))):              # her other hand, holding her own arm
        y = 0.512 - i * 0.021
        R.sweep([(0.286, y - 0.008, 0.0082, 0.010), (0.286 + ln * 0.5, y + 0.003 + dy, 0.0080, 0.030), (0.286 + ln, y + dy * 2, 0.0062, 0.022)], SKIN, 0.8)
    for sg in (-1, 1):
        R.bump((0.50 + sg * 0.066, 0.548), 0.036, 0.048, 0.012, sg * 12)                                         # shoulder blades
    for i in range(6):
        R.bump((0.50, 0.492 + i * 0.023), 0.011, 0.0080, 0.0055)                                                 # too much spine
    folds = [([(0.42 + 0.16 * t, 0.36), (0.37 + 0.26 * t + (rr.random() - 0.5) * 0.03, 0.22), (0.25 + 0.50 * t, 0.06)], 0.012, 0.028)
             for t in np.linspace(0.04, 0.96, 8)]
    folds += [([(0.39, 0.372 + d), (0.50, 0.358 + d), (0.61, 0.375 + d)], 0.008, 0.008) for d in (0.0, 0.035)]
    R.emboss(cv.lines(folds, 0.008) - 0.25, 0.018, CLOTH)
    col, a = shade(cv, R, 600, {SKIN: (198, 198, 194), CLOTH: (134, 138, 143)}, L=SOB_LIGHT, mottle=0.30)
    n_lo, n_mid = cv.noise(0.30, 602), cv.noise(0.075, 603)
    col *= (1 - 0.28 * sstep(0.50, 0.80, cv.noise(0.14, 604)))[..., None]                                        # grime
    col *= (0.40 + 0.60 * sstep(0.03, 0.56, Y))[..., None]                                                       # the floor is darker than the window
    a *= (0.90 + 0.08 * n_lo) * (0.30 + 0.70 * sstep(0.0, 0.5, n_mid * 0.6 + (Y - 0.015) * 5))
    paths, sheen = [], []                                                                                       # the hair that lies down her back
    for i in range(150):
        sg = -1 if rr.random() < 0.5 else 1
        q = rr.random() ** 0.8
        x0 = 0.50 + sg * (0.030 + 0.075 * q)
        ln = 0.13 + 0.25 * rr.random() ** 1.3
        sw = (rr.random() - 0.5) * 0.03 + sg * (0.035 + 0.045 * q)
        wd = 0.0020 + 0.0040 * rr.random() ** 1.7
        pts = [(x0 - sg * 0.010, 0.675), (x0, 0.635), (x0 + sw * 0.75, 0.62 - ln * 0.5), (x0 + sw, 0.62 - ln)]
        paths.append((pts, wd, 0.0010, 1.0, 0.4))
        if rr.random() < 0.25:
            sheen.append((pts[1:], 0.0016, 0.0009, 0.7, 0.1))
    hair = np.clip(blur(cv.lines(paths), 0.6) * 1.15, 0, 1) * sstep(0.675, 0.655, Y)
    return col, a, R.mask, hair, blur(cv.lines(sheen), 0.7) * sstep(0.675, 0.655, Y)


def paint_sob(turn):
    cv = Canvas(1.0, 1.0, 640)
    X, Y, k = cv.X, cv.Y, cv.k
    b_col, b_a, b_mask, b_hair, b_sheen = sob_body(cv)
    n_mid, n_hi = cv.noise(0.075, 610), cv.noise(0.018, 611, 3)
    rr = np.random.default_rng(620 + int(turn))
    clip = sstep(0.575, 0.625, Y + 0.30 * np.abs(X - 0.5))                    # head hair ends where the back hair takes over
    R = Relief(cv)
    paths, sheen = [], []
    if not turn:
        # bowed right over: a little of the nape, then the back of the head
        R.sweep([(0.50, 0.606, 0.041, -0.03), (0.50, 0.640, 0.039, -0.04), (0.50, 0.672, 0.039, -0.06)], SKIN)
        for i in range(3):
            R.bump((0.50, 0.618 + i * 0.019), 0.010, 0.0070, 0.006)
        R.blob((0.50, 0.708), 0.088, 0.080, 0, -0.07, 0.09, HAIR)
        for i in range(230):
            t = rr.random() * 2 - 1
            sg = 1 if t > 0 else -1
            wd = 0.0020 + 0.0040 * rr.random() ** 1.7
            top = (0.50 + 0.012 * t, 0.778 + 0.010 * rr.random())
            mid = (0.50 + 0.088 * t * (0.75 + 0.3 * rr.random()), 0.712 + 0.03 * (rr.random() - 0.5))
            if abs(t) < 0.30:                                                # down the back of the head to a point at the nape
                end = (0.50 + 0.060 * t, 0.628 + 0.11 * abs(t) + 0.012 * rr.random())
                paths.append(([top, mid, end], wd, 0.0012, 1.0, 0.7))
            else:                                                            # forward and down past the neck on either side
                low = (0.50 + sg * (0.034 + 0.095 * abs(t) * rr.random() ** 0.6), 0.640)
                end = (low[0] + sg * 0.02 * rr.random(), 0.555 + 0.05 * rr.random())
                paths.append(([top, mid, low, end], wd, 0.0012, 1.0, 0.6))
            if rr.random() < 0.3:
                sheen.append(([top, mid], 0.0016, 0.0010, 0.2, 0.8))
        R.emboss(cv.lines(paths), 0.004, HAIR)
    else:
        # the head has come right round over her shoulder
        hc, tilt, s, yaw = (0.546, 0.716), -17.0, 0.93, 0.34
        R.sweep([(0.505, 0.606, 0.041, -0.03), (0.520, 0.640, 0.039, -0.02), (0.534, 0.672, 0.039, -0.01)], SKIN)
        twist = [([(0.478 + 0.012 * i, 0.612 + 0.016 * i), (0.515 + 0.008 * i, 0.626 + 0.016 * i), (0.556 + 0.004 * i, 0.660 + 0.012 * i)], 0.006, 0.004) for i in range(4)]
        R.emboss(cv.lines(twist, 0.003), -0.006, SKIN)                        # the skin of the neck is wound round
        f = a_head(R, hc, s, roll=tilt, yaw=yaw, z=0.0, lids=False, hair=False)
        cr, sr = math.cos(math.radians(tilt)), math.sin(math.radians(tilt))
        T = lambda u, v: (hc[0] + s * (u * cr - v * sr), hc[1] + s * (u * sr + v * cr))
        fx = yaw * 0.042
        for sg in (-1, 1):                                                   # cheeks pushed up by the smile
            R.bump(T(fx + sg * 0.040 * (1 - 0.3 * max(0, sg * yaw)), -0.068), 0.015, 0.012, 0.006, tilt)
        for i in range(260):
            near = rr.random() < 0.68                                        # most of it is on the side turned to us
            sg = -1 if near else 1
            ur = sg * 0.085 * rr.random() ** 0.8
            capv = math.sqrt(max(0.0, 1 - (ur / 0.090) ** 2))
            wd = 0.0020 + 0.0040 * rr.random() ** 1.7
            root = T(ur, 0.045 + 0.060 * capv * rr.random())
            out = (0.050 + 0.050 * rr.random()) if near else (0.070 + 0.018 * rr.random())
            brow = T(sg * out * 0.85 + ur * 0.2, 0.030)
            side = T(sg * out, -0.045)
            end = (side[0] + sg * 0.03 * rr.random() - 0.02, 0.555 + 0.06 * rr.random())
            paths.append(([root, brow, side, ((side[0] + end[0]) / 2, (side[1] + end[1]) / 2), end], wd, 0.0012, 1.0, 0.6))
            if rr.random() < 0.3:
                sheen.append(([root, brow, side], 0.0016, 0.0010, 0.8, 0.2))

    col, a = shade(cv, R, 612, {SKIN: (214, 214, 210), HAIR: (30, 33, 40)}, L=SOB_LIGHT, cast=0.35, mottle=0.14)
    a *= 0.96
    locks = np.clip(blur(cv.lines(paths), 0.6) * 1.15, 0, 1) * clip
    L = Layer(cv.W, cv.H)
    solid = np.maximum(b_mask, R.mask)
    haze = sstep(0.06, 0.8, blur(solid, 0.045 * k) * (0.45 + 0.9 * n_mid))
    L.over((78, 88, 102), haze * 0.11)                                        # night air from the window beyond her
    L.over((5, 6, 9), np.exp(-((X - 0.5) / 0.34) ** 2 - ((Y - 0.03) / 0.045) ** 2) * 0.55)   # she sits in her own shadow
    L.over(b_col, b_a)
    L.over((8, 9, 13), np.clip(blur(shift(b_hair, 2, 3), 3.0) * 0.5, 0, 1) * b_a)
    L.over(SOB_HAIR, b_hair)
    L.over((56, 64, 78), b_sheen * 0.45)
    L.over((8, 9, 13), np.clip(blur(shift(R.mask, 3, 5), 6.0) * 0.45, 0, 1) * b_a * sstep(0.54, 0.62, Y))   # the head shades the shoulders
    if turn:                                                                 # the mass of hair behind the head
        L.over(SOB_HAIR, sstep(0.40, 0.56, cv.gauss(T(-0.018, 0.022), 0.108 * s, 0.112 * s, tilt) + (n_hi - 0.5) * 0.10) * 0.96 * sstep(0.60, 0.66, Y))
    L.over(col, a)
    if turn:
        mxu = fx + yaw * 0.008
        for pt, rx, ry, al in ((T(fx, -0.006), 0.060, 0.016, 0.34), (T(fx + 0.014, -0.045), 0.010, 0.026, 0.30),
                               (T(mxu, -0.118), 0.020, 0.007, 0.34), (T(fx - 0.050, -0.085), 0.018, 0.034, 0.40),
                               (T(fx + 0.040, -0.085), 0.012, 0.030, 0.30)):                                    # brow, nose, lip and cheek shadows
            L.over((70, 70, 80), cv.gauss(pt, s * rx, s * ry, tilt) * al * a)
        for key, off in (('eye-1', 0.0012), ('eye1', -0.0008)):
            e, erx = f[key]
            w = erx / 0.018                                                  # the far eye is narrower
            L.over((36, 33, 42), np.clip(cv.gauss((e[0], e[1] + 0.004), s * 0.031 * w, s * 0.024, tilt) * 1.1, 0, 1) * 0.66)   # sunk in shadow
            ball = sstep(0.32, 0.58, cv.gauss(e, s * 0.0255 * w, s * 0.0160, tilt))
            lidsh = sstep(-0.007, 0.009, (e[1] - Y) * cr + (X - e[0]) * sr)                                     # darker under the lid
            L.over(V3(188, 192, 196) * (0.42 + 0.58 * lidsh)[..., None], ball * 0.95)                           # too much white
            p = (e[0] + off, e[1] - 0.0005)
            L.over((12, 12, 16), sstep(0.30, 0.62, cv.gauss(p, s * 0.0084 * min(1.0, w + 0.15), s * 0.0084)) * 0.97 * ball)
            L.over((238, 242, 246), cv.gauss((p[0] - 0.002, p[1] + 0.002), 0.0014) * 0.85)
        half = lambda sg: 0.046 * (1 - 0.32 * max(0.0, sg * yaw))
        us = np.linspace(-1, 1, 21)
        top = [T(mxu + u * half(1 if u > 0 else -1), -0.092 + (0.027 if u < 0 else 0.022) * abs(u) ** 1.8) for u in us]
        bot = [T(mxu + u * half(1 if u > 0 else -1), -0.092 + (0.027 if u < 0 else 0.022) * abs(u) ** 1.8 - 0.0105 * (1 - abs(u) ** 1.5)) for u in us]
        mid = [((a_[0] + b_[0]) / 2, (a_[1] + b_[1]) / 2) for a_, b_ in zip(top, bot)]
        band = cv.lines([(mid[:11], 0.0010, 0.0105), (mid[10:], 0.0105, 0.0010)], 0.0008)
        L.over((24, 15, 19), np.clip(band * 1.3, 0, 1) * 0.92 * a)                                              # the mouth, far too wide
        teeth = cv.lines([(mid[3:11], 0.0008, 0.0062), (mid[10:18], 0.0062, 0.0008)], 0.0008)
        gaps = 0.72 + 0.28 * np.sin(((X - hc[0]) * cr + (Y - hc[1]) * sr) / s * 2 * math.pi / 0.0085) ** 2
        L.over(V3(178, 176, 166) * gaps[..., None], np.clip(teeth * 1.2, 0, 1) * 0.80 * a)
        for sg, pt in ((-1, top[0]), (1, top[-1])):                          # the corners dig in
            L.over((30, 24, 30), cv.gauss(pt, 0.0055, 0.0085, tilt + sg * 30) * 0.55 * a)
        U = ((X - hc[0]) * cr + (Y - hc[1]) * sr) / s
        Vv = ((Y - hc[1]) * cr - (X - hc[0]) * sr) / s
        cap = sstep(0.42, 0.60, cv.gauss(T(-0.012, 0.062), 0.100 * s, 0.062 * s, tilt) + (n_hi - 0.5) * 0.12)
        cap *= sstep(-0.004, 0.010, Vv - (0.060 - 0.25 * np.abs(U - fx) - 6.0 * (U - fx) ** 2))
        L.over((8, 9, 14), np.clip(blur(shift(np.maximum(locks, cap), 2, 3), 3.0) * 0.55, 0, 1) * a)             # hair shades the face
        L.over(SOB_HAIR, cap * a * 0.97)
    L.over(SOB_HAIR, locks)
    L.over((60, 68, 82), blur(cv.lines(sheen), 0.7) * 0.5 * clip)
    L.fade(cv.edges(0.05, 0.015))
    bend = ((cv.noise(0.25, 606, 3) - 0.5) * 0.006 * k, (cv.noise(0.25, 607, 3) - 0.5) * 0.006 * k)
    save('sob_turn.png' if turn else 'sob_back.png', L, (512, 512), (40, 44, 50), 608, bend, soften=0.6)


# ---- 4. the wraith between the trunks -------------------------------------------------------
# 0.8 x 2.6 m. Hardly anything: a pale streak with shoulders, a hollow face near the top, wisps trailing down.

def paint_wraith():
    cv = Canvas(0.8, 2.6, 400)
    X, Y, k = cv.X, cv.Y, cv.k
    rr = np.random.default_rng(701)
    n_lo, n_mid = cv.noise(0.45, 702), cv.noise(0.09, 703)
    n_str = cv.noise(0.13, 704, 4, sx=0.22, sy=7.0)
    n_fine = cv.noise(0.035, 705, 3, sx=0.3, sy=5.0)
    xc = 0.40 + 0.045 * np.sin(Y * 2.0 + 0.6) + (n_lo - 0.5) * 0.05          # it leans as it drifts
    ys = np.array([0.0, 0.25, 0.8, 1.5, 1.92, 2.00, 2.10, 2.17, 2.30, 2.40, 2.6])
    ws = np.array([0.012, 0.030, 0.062, 0.092, 0.118, 0.110, 0.050, 0.046, 0.074, 0.050, 0.02])
    w = np.interp(Y, ys, ws).astype(F32)
    body = np.exp(-((X - xc) / w) ** 2) * sstep(2.48, 2.36, Y) * sstep(0.02, 0.9, Y) ** 0.8
    a = body * (0.30 + 0.95 * n_str) * (0.75 + 0.5 * n_fine)
    arms = np.zeros_like(a)                                                  # two thinner streams where arms would hang
    for sg in (-1, 1):
        xa = xc + sg * (0.115 + 0.035 * sstep(1.95, 1.0, Y))
        arms += np.exp(-((X - xa) / 0.022) ** 2) * sstep(2.0, 1.88, Y) * sstep(0.75, 1.25, Y)
    a += arms * (0.20 + 0.8 * n_str) * 0.45
    paths = []
    for i in range(46):                                                      # wisps let down from it
        y0 = 0.5 + 1.3 * rr.random()
        x0 = float(np.interp(y0, [0, 2.6], [0.40, 0.40])) + 0.045 * math.sin(y0 * 2.0 + 0.6) + (rr.random() - 0.5) * 0.17
        ln = 0.35 + 0.75 * rr.random()
        dr = (rr.random() - 0.5) * 0.10
        paths.append(([(x0, y0), (x0 + dr * 0.3, y0 - ln * 0.4), (x0 + dr, y0 - ln * 0.75), (x0 + dr * 0.8, max(0.06, y0 - ln))],
                      0.004 + 0.008 * rr.random(), 0.002, 0.7, 0.0))
    a += blur(cv.lines(paths), 0.006 * k) * 0.42 * (0.4 + 0.8 * n_mid)
    a = blur(a, 0.006 * k)
    hx = 0.40 + 0.045 * math.sin(2.30 * 2.0 + 0.6)
    hx += float(((n_lo - 0.5) * 0.05)[int((2.6 - 2.30) * k), int(hx * k)])
    hollow = np.zeros_like(a)                                                # the face is only where the haze is missing
    for sg in (-1, 1):
        hollow = np.maximum(hollow, cv.gauss((hx + sg * 0.027, 2.315), 0.017, 0.021, sg * -12))
    hollow = np.maximum(hollow, cv.gauss((hx + 0.003, 2.222), 0.014, 0.034))
    hollow = np.clip(hollow * 1.2, 0, 1)
    a *= 1 - 0.68 * blur(hollow, 0.004 * k)
    a *= 0.55 / float(np.percentile(a[a > 0.02 * a.max()], 96))             # most of the core sits near the peak
    a = np.minimum(a, 0.55)
    core = sstep(0.05, 0.45, a)[..., None]
    col = V3(118, 136, 152) * (1 - core) + V3(196, 205, 212) * core
    col = col * (1 - 0.45 * hollow[..., None])
    L = Layer(cv.W, cv.H)
    L.over(col, a)
    L.fade(cv.edges(0.07))
    save('wraith.png', L, (256, 1024), (130, 146, 160), 708)


# ---- 5. the ones that cross -----------------------------------------------------------------
# Pale things caught moving to the right (+u); mirror the plane for the other way. Dragged out sideways.

def hblur(a, s):
    r = int(math.ceil(s * 3))
    kk = np.exp(-np.arange(-r, r + 1, dtype=F32) ** 2 / (2 * s * s))
    kk /= kk.sum()
    p = np.pad(a, ((0, 0), (r, r)))
    out = np.zeros_like(a)
    for i, kv in enumerate(kk):
        out += kv * p[:, i:i + a.shape[1]]
    return out


def trail(a, length):
    """Drag everything out to the left with an exponential tail of `length` px (the thing is moving right)."""
    g = math.exp(-1.0 / length)
    out = np.empty_like(a)
    acc = np.zeros(a.shape[0], F32)
    for x in range(a.shape[1] - 1, -1, -1):
        acc = a[:, x] * (1 - g) + acc * g
        out[:, x] = acc
    return out


def boxblur(a, n):
    """Horizontal box blur over n px: what a shutter does to something crossing the frame."""
    n = max(1, int(n))
    c = np.cumsum(np.pad(a, ((0, 0), (n // 2 + 1, n - n // 2))), axis=1)
    return (c[:, n:n + a.shape[1]] - c[:, :a.shape[1]]) / n


def smear(cv, L, length, tail, sharp=0.38, soft=0.03):
    """Motion blur for a layer: mostly a shutter smear, a softened figure inside it, a short tail behind."""
    k = cv.k
    out = Layer(cv.W, cv.H)
    ch = []
    for c in (L.c[..., 0], L.c[..., 1], L.c[..., 2], L.a):
        ch.append(boxblur(c, length * k) * 0.55 + hblur(c, soft * k) * sharp + trail(c, tail * k) * 0.30)
    over = np.maximum(ch[3], 1.0)
    out.c = np.stack([c / over for c in ch[:3]], -1)
    out.a = ch[3] / over
    return out


def cross_finish(name, cv, R, seed, size, length, tail, hair=(), fade=0.05, peak=0.92):
    X, Y, k = cv.X, cv.Y, cv.k
    col, a = shade(cv, R, seed, {SKIN: (208, 209, 207), CLOTH: (178, 182, 186), HAIR: (20, 22, 28)}, cast=0.35, mottle=0.2)
    n_lo = cv.noise(0.30, seed + 5)
    a *= peak * (0.80 + 0.20 * n_lo)
    L = Layer(cv.W, cv.H)
    L.over(col, a)
    if hair:
        L.over((6, 6, 9), np.clip(blur(cv.lines(hair), 0.6) * 1.1, 0, 1) * 0.9)
    L = smear(cv, L, length, tail)
    streak = cv.noise(0.06, seed + 6, 3, sx=9.0, sy=0.3)                     # the smear is in streaks, not a film
    L.fade(1 - 0.40 * (1 - streak) * sstep(0.75, 0.30, hblur(L.a, 0.01 * k)))
    L.fade(np.minimum(1.0, sstep(0.04, 0.50 * cv.pw, X) ** 0.7 * cv.edges(fade, 0.02 if fade > 0.03 else fade)))
    for i in range(3):                                                       # nothing stays quite sharp
        L.c[..., i] = blur(L.c[..., i], 0.003 * k)
    L.a = blur(L.a, 0.003 * k)
    save(name, L, size, (150, 156, 162), seed + 9)


def paint_crosser_run():
    """A thin pale figure loping across, bent forward, arms too long."""
    cv = Canvas(1.6, 1.8, 400)
    R = Relief(cv)
    hip, chest, head = (1.02, 0.93), (1.20, 1.31), (1.325, 1.475)
    limb(R, hip, (0.90, 0.56), 0.062, 0.040, -0.05, -0.05)                   # far leg, kicked back
    limb(R, (0.90, 0.56), (0.63, 0.44), 0.042, 0.024, -0.05, -0.05, belly=1.25)
    limb(R, (0.63, 0.44), (0.52, 0.37), 0.024, 0.015, -0.05, -0.05)
    limb(R, (1.17, 1.33), (1.00, 1.19), 0.036, 0.026, -0.06, -0.06)          # far arm, trailing
    limb(R, (1.00, 1.19), (0.85, 1.03), 0.027, 0.018, -0.06, -0.06)
    hand(R, (0.85, 1.03), (0.76, 0.87), -0.06, -0.06, thumb=0, fan=0.12)
    R.sweep([hip + (0.090, 0.0), (1.10, 1.13, 0.080, 0.0), chest + (0.098, 0.0)], CLOTH, 0.75)      # the body, pitched forward
    R.sweep([(1.23, 1.37, 0.040, 0.01), (1.285, 1.43, 0.036, 0.02)], SKIN)
    R.blob(head, 0.088, 0.078, 25, 0.02, 0.08, SKIN)
    limb(R, hip, (1.27, 0.64), 0.066, 0.042, 0.03, 0.04)                     # near leg, reaching
    limb(R, (1.27, 0.64), (1.23, 0.22), 0.044, 0.025, 0.04, 0.04, belly=1.25)
    limb(R, (1.23, 0.22), (1.35, 0.13), 0.026, 0.016, 0.04, 0.04)
    limb(R, (1.21, 1.34), (1.37, 1.15), 0.038, 0.027, 0.05, 0.06)            # near arm, reaching ahead and down
    limb(R, (1.37, 1.15), (1.50, 1.00), 0.028, 0.018, 0.06, 0.06)
    hand(R, (1.50, 1.00), (1.565, 0.83), 0.06, 0.06, thumb=0, fan=0.12)
    rr = np.random.default_rng(801)
    hair = [([(head[0] - 0.02 + 0.07 * rr.random(), head[1] + 0.02 + 0.06 * rr.random()), (head[0] - 0.12 - 0.05 * rr.random(), head[1] + 0.03 * rr.random()),
              (head[0] - 0.24 - 0.20 * rr.random(), head[1] - 0.02 - 0.12 * rr.random())], 0.005 + 0.007 * rr.random(), 0.002, 1.0, 0.3) for _ in range(70)]
    cross_finish('crosser_run.png', cv, R, 800, (512, 576), 0.20, 0.13, hair)


def paint_crosser_low():
    """Something pale going across on all fours, belly to the floor, elbows and knees above its back."""
    cv = Canvas(1.8, 0.45, 640)
    R = Relief(cv)
    hip, chest, head = (0.74, 0.185), (1.10, 0.160), (1.285, 0.135)
    limb(R, hip, (0.615, 0.285), 0.044, 0.030, -0.05, -0.05)                 # far hind leg
    limb(R, (0.615, 0.285), (0.52, 0.045), 0.030, 0.018, -0.05, -0.05)
    limb(R, (1.06, 0.18), (0.975, 0.268), 0.032, 0.024, -0.05, -0.05)        # far arm
    limb(R, (0.975, 0.268), (1.01, 0.045), 0.024, 0.015, -0.05, -0.05)
    R.sweep([hip + (0.068, 0.0), (0.92, 0.185, 0.050, 0.0), chest + (0.064, 0.0)], CLOTH, 0.8)       # a long back, hollow in the middle
    R.sweep([(1.15, 0.155, 0.034, 0.01), (1.22, 0.145, 0.031, 0.02)], SKIN)
    R.blob(head, 0.072, 0.062, -10, 0.02, 0.06, SKIN)
    limb(R, hip, (0.835, 0.365), 0.048, 0.031, 0.04, 0.04)                   # near hind leg, the knee above the back
    limb(R, (0.835, 0.365), (0.905, 0.045), 0.031, 0.019, 0.04, 0.04)
    limb(R, (1.10, 0.185), (1.200, 0.318), 0.033, 0.025, 0.05, 0.05)         # near arm, planted well ahead
    limb(R, (1.200, 0.318), (1.375, 0.062), 0.025, 0.016, 0.05, 0.05)
    hand(R, (1.375, 0.062), (1.51, 0.032), 0.05, 0.05, width=0.06, r=0.0075, thumb=0, fan=0.25)
    rr = np.random.default_rng(811)
    hair = [([(head[0] - 0.03 + 0.07 * rr.random(), head[1] + 0.03 * rr.random()), (head[0] - 0.05 - 0.06 * rr.random(), head[1] - 0.05 - 0.03 * rr.random()),
              (head[0] - 0.16 - 0.22 * rr.random(), 0.03 + 0.05 * rr.random())], 0.004 + 0.006 * rr.random(), 0.002, 1.0, 0.3) for _ in range(60)]
    cross_finish('crosser_low.png', cv, R, 810, (1024, 256), 0.18, 0.13, hair, fade=0.03)


def paint_crosser_window():
    """A face going past behind the glass, turned to look in as it goes."""
    cv = Canvas(0.5, 1.0, 512)
    R = Relief(cv)
    R.sweep([(0.185, 0.335, 0.044, -0.04), (0.300, 0.395, 0.058, -0.02), (0.415, 0.340, 0.044, -0.04)], CLOTH, 0.7)
    R.sweep([(0.300, 0.20, 0.105, -0.06), (0.300, 0.33, 0.095, -0.05)], CLOTH, 0.5)
    R.sweep([(0.300, 0.42, 0.034, 0.0), (0.306, 0.52, 0.032, 0.02)], SKIN)
    hc = (0.312, 0.640)
    f = a_head(R, hc, 1.0, roll=-7, yaw=0.15, z=0.04, lids=False, hair=False)
    rr = np.random.default_rng(821)
    hair = []
    for i in range(110):
        sg = -1 if rr.random() < 0.6 else 1
        ur = sg * 0.085 * rr.random() ** 0.8
        root = (hc[0] + ur, hc[1] + 0.045 + 0.06 * math.sqrt(max(0.0, 1 - (ur / 0.09) ** 2)) * rr.random())
        side = (hc[0] + sg * (0.072 + 0.02 * rr.random()), hc[1] - 0.04)
        end = (side[0] - 0.03 - 0.07 * rr.random(), 0.30 + 0.20 * rr.random())
        hair.append(([root, (hc[0] + sg * 0.07 + ur * 0.2, hc[1] + 0.03), side, end], 0.003 + 0.005 * rr.random(), 0.0015, 1.0, 0.4))
    cap = [([(hc[0] - 0.08, hc[1] + 0.055), (hc[0], hc[1] + 0.085), (hc[0] + 0.075, hc[1] + 0.05)], 0.05, 0.05)]
    col, a = shade(cv, R, 820, {SKIN: (210, 211, 209), CLOTH: (140, 145, 152)}, cast=0.35, mottle=0.2)
    col *= (0.25 + 0.75 * sstep(0.25, 0.56, cv.Y))[..., None]
    for key in ('eye-1', 'eye1'):                                            # eyes and mouth: three dark places
        p, erx = f[key]
        d = np.clip(cv.gauss(p, erx * 1.25, 0.0150, -7) * 1.3, 0, 1) * 0.94
        col = col * (1 - d[..., None]) + V3(12, 13, 18) * d[..., None]
    d = np.clip(cv.gauss(f['mouth'], 0.014, 0.011, -7) * 1.2, 0, 1) * 0.85
    col = col * (1 - d[..., None]) + V3(12, 11, 15) * d[..., None]
    L = Layer(cv.W, cv.H)
    L.over(col, a * (0.45 + 0.50 * sstep(0.44, 0.54, cv.Y)))
    L.over((6, 6, 9), np.clip(blur(cv.lines(cap), 0.004 * cv.k) * 1.4, 0, 1) * a * 0.95)
    L.over((6, 6, 9), np.clip(blur(cv.lines(hair), 0.6) * 1.1, 0, 1) * 0.9)
    L = smear(cv, L, 0.045, 0.05, sharp=0.50, soft=0.010)
    L.fade(1 - 0.38 * (1 - cv.noise(0.05, 826, 3, sx=8.0, sy=0.3)) * sstep(0.75, 0.30, L.a))
    L.fade(cv.edges(0.06) * sstep(0.10, 0.36, cv.Y) * sstep(0.02, 0.22, cv.X) ** 0.7)
    for i in range(3):
        L.c[..., i] = blur(L.c[..., i], 0.003 * cv.k)
    L.a = blur(L.a, 0.003 * cv.k)
    save('crosser_window.png', L, (256, 512), (150, 156, 162), 829)


PAINTERS = {
    'angel_0': paint_angel_0,
    'angel_1': paint_angel_1,
    'angel_2': paint_angel_2,
    'angel_3': paint_angel_3,
    'ceiling_woman': paint_ceiling_woman,
    'sob_back': lambda: paint_sob(False),
    'sob_turn': lambda: paint_sob(True),
    'wraith': paint_wraith,
    'crosser_run': paint_crosser_run,
    'crosser_low': paint_crosser_low,
    'crosser_window': paint_crosser_window,
}

if __name__ == '__main__':
    want = sys.argv[1:]
    for name, fn in PAINTERS.items():
        if not want or any(name.startswith(w) for w in want):
            fn()
