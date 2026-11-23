"""Deterministic HUD overlay for the screenshot set (PIL + numpy only, no image model).

All coordinates are authored on a 1920x1080 design grid and drawn 2x supersampled,
then downsampled, so text and vector shapes stay crisp at any 16:9 output size.
"""
import math
import numpy as np
from PIL import Image, ImageDraw, ImageFilter, ImageFont

FONT = "C:/Windows/Fonts/bahnschrift.ttf"
SS = 2  # supersampling

WHITE = (238, 245, 255)
DIM = (176, 192, 214)
FAINT = (130, 148, 172)
GREEN = (92, 224, 132)
CYAN = (96, 204, 255)
AMBER = (255, 178, 72)
PANEL = (7, 13, 24)


class Hud:
    def __init__(self, base):
        self.base = base.convert("RGB")
        self.W, self.H = self.base.size
        self.u = self.W / 1920 * SS                      # design unit -> supersampled px
        self.layer = Image.new("RGBA", (self.W * SS, self.H * SS), (0, 0, 0, 0))
        self.d = ImageDraw.Draw(self.layer)
        self.glass = Image.new("L", (self.W * SS, self.H * SS), 0)   # where to blur/darken the backdrop
        self.gd = ImageDraw.Draw(self.glass)
        self.shadow = Image.new("L", (self.W * SS, self.H * SS), 0)  # soft drop shadow for loose text
        self.sd = ImageDraw.Draw(self.shadow)
        self._fonts = {}

    # ---------- primitives ----------
    def p(self, v):
        return v * self.u

    def font(self, size, weight="Regular"):
        key = (round(size * self.u), weight)
        if key not in self._fonts:
            f = ImageFont.truetype(FONT, key[0])
            f.set_variation_by_name(weight)
            self._fonts[key] = f
        return self._fonts[key]

    def tw(self, s, size, weight="Regular", track=0):
        f = self.font(size, weight)
        if track:
            return sum(f.getlength(c) for c in s) / self.u + track * (len(s) - 1)
        return f.getlength(s) / self.u

    def text(self, x, y, s, size, color=WHITE, weight="Regular", anchor="ls", alpha=255, track=0, shadow=True):
        """x,y in design units; anchor baseline by default."""
        f = self.font(size, weight)
        fill = color + (alpha,)
        if track:
            w = self.tw(s, size, weight, track)
            if anchor[0] == "r": x -= w
            elif anchor[0] == "m": x -= w / 2
            for c in s:
                self.d.text((self.p(x), self.p(y)), c, font=f, fill=fill, anchor="l" + anchor[1])
                if shadow: self.sd.text((self.p(x), self.p(y + 1)), c, font=f, fill=150, anchor="l" + anchor[1])
                x += f.getlength(c) / self.u + track
            return
        self.d.text((self.p(x), self.p(y)), s, font=f, fill=fill, anchor=anchor)
        if shadow:
            self.sd.text((self.p(x), self.p(y + 1)), s, font=f, fill=150, anchor=anchor)

    def panel(self, x, y, w, h, r=10, border=True):
        box = [self.p(x), self.p(y), self.p(x + w), self.p(y + h)]
        self.gd.rounded_rectangle(box, radius=self.p(r), fill=255)
        if border:
            self.d.rounded_rectangle(box, radius=self.p(r), outline=(190, 215, 255, 46), width=max(1, round(self.p(1))))

    def line(self, pts, color, width=1.5, alpha=255):
        self.d.line([(self.p(x), self.p(y)) for x, y in pts], fill=color + (alpha,), width=max(1, round(self.p(width))), joint="curve")

    def rrect(self, x, y, w, h, r, fill=None, outline=None, width=1.5):
        self.d.rounded_rectangle([self.p(x), self.p(y), self.p(x + w), self.p(y + h)], radius=self.p(r), fill=fill,
                                 outline=outline, width=max(1, round(self.p(width))))

    def circle(self, cx, cy, r, fill=None, outline=None, width=1.5):
        self.d.ellipse([self.p(cx - r), self.p(cy - r), self.p(cx + r), self.p(cy + r)], fill=fill, outline=outline,
                       width=max(1, round(self.p(width))))

    def poly(self, pts, fill):
        self.d.polygon([(self.p(x), self.p(y)) for x, y in pts], fill=fill)

    def bar(self, x, y, w, h, frac, color, back=(255, 255, 255, 38)):
        self.rrect(x, y, w, h, h / 2, fill=back)
        if frac > 0:
            self.rrect(x, y, max(h, w * frac), h, h / 2, fill=color + (255,))

    # ---------- widgets ----------
    def objectives(self, location, title, items, x=28, y=24):
        """items: list of (text, state) with state in {'done','active','todo'}"""
        row, size = 31, 21
        w = max([self.tw(title, 31, "SemiBold")] + [self.tw(t, size) + 30 for t, _ in items] +
                [self.tw(location, 14, "SemiBold", 1.6)]) + 40
        h = 22 + 22 + 40 + row * len(items) + 6
        self.panel(x, y, w, h)
        tx = x + 20
        self.text(tx, y + 30, location, 14, CYAN, "SemiBold", track=1.6, alpha=235)
        self.text(tx, y + 66, title, 31, WHITE, "SemiBold")
        yy = y + 66 + 34
        for t, state in items:
            b = 16
            bx, by = tx, yy - b + 2
            if state == "done":
                self.rrect(bx, by, b, b, 3.5, fill=GREEN + (255,))
                self.line([(bx + 3.6, by + 8.4), (bx + 6.9, by + 11.6), (bx + 12.6, by + 4.6)], (6, 30, 16), 2.2)
                self.text(tx + 28, yy, t, size, GREEN)
            elif state == "active":
                self.rrect(bx, by, b, b, 3.5, outline=WHITE + (255,), width=1.6)
                self.rrect(bx + 4.5, by + 4.5, b - 9, b - 9, 1.5, fill=CYAN + (255,))
                self.text(tx + 28, yy, t, size, WHITE)
            else:
                self.rrect(bx, by, b, b, 3.5, outline=DIM + (230,), width=1.6)
                self.text(tx + 28, yy, t, size, DIM)
            yy += row

    def flight_data(self, rows, right=1892, y=24):
        """rows: list of (label, value)"""
        row, size = 31, 21
        lw = max(self.tw(l, size) for l, _ in rows)
        vw = max(self.tw(v, size, "SemiBold") for _, v in rows)
        w = lw + vw + 36 + 40
        h = 20 + row * len(rows) + 8
        x = right - w
        self.panel(x, y, w, h)
        yy = y + 20 + 21
        for l, v in rows:
            self.text(x + 20, yy, l, size, DIM)
            self.text(right - 20, yy, v, size, WHITE, "SemiBold", anchor="rs")
            yy += row

    def navball(self, mode, speed, hdg, pitch=6.0, roll=-4.0, prograde=(0.28, -0.22), sas=0, cx=150, cy=912, R=76):
        u = self.u
        ring = R + 17
        # backdrop disc
        self.gd.ellipse([self.p(cx - ring - 6), self.p(cy - ring - 6), self.p(cx + ring + 6), self.p(cy + ring + 6)], fill=255)
        self.circle(cx, cy, ring + 6, outline=(190, 215, 255, 46), width=1)
        # tick ring (heading tape wrapped around the ball)
        for a in range(0, 360, 10):
            major = a % 30 == 0
            r0, r1 = R + 5, R + (13 if major else 9)
            ca, sa = math.cos(math.radians(a - 90)), math.sin(math.radians(a - 90))
            self.line([(cx + ca * r0, cy + sa * r0), (cx + ca * r1, cy + sa * r1)], WHITE, 1.6 if major else 1.1, 235 if major else 130)
        # shaded attitude sphere (numpy)
        n = int(round(2 * R * u))
        yy, xx = np.mgrid[0:n, 0:n].astype(np.float32)
        nx = (xx - n / 2 + 0.5) / (n / 2)
        ny = (yy - n / 2 + 0.5) / (n / 2)
        rr = np.sqrt(nx * nx + ny * ny)
        nz = np.sqrt(np.clip(1 - rr * rr, 0, 1))
        ro = math.radians(roll)
        vy = -nx * math.sin(ro) + ny * math.cos(ro)          # coordinate perpendicular to the horizon
        lat = np.degrees(np.arcsin(np.clip(vy, -1, 1))) + pitch   # degrees below the horizon
        sky_t = np.clip(-lat / 80, 0, 1)[..., None]
        gnd_t = np.clip(lat / 80, 0, 1)[..., None]
        sky = np.array([98, 188, 250], np.float32) * (1 - sky_t) + np.array([24, 96, 190], np.float32) * sky_t
        gnd = np.array([240, 140, 44], np.float32) * (1 - gnd_t) + np.array([150, 66, 14], np.float32) * gnd_t
        col = np.where((lat < 0)[..., None], sky, gnd)
        # pitch ladder + horizon
        vx = nx * math.cos(ro) + ny * math.sin(ro)
        px_deg = 180 / (n / 2) / math.pi * 1.2            # approx line thickness in degrees
        for deg, half, a in [(0, 2.0, 1.0)] + [(d, 0.26 if d % 30 else 0.40, 0.75) for d in (-60, -45, -30, -15, 15, 30, 45, 60)]:
            m = np.clip(1 - np.abs(lat - deg) / (px_deg * (1.5 if deg == 0 else 1.0)), 0, 1) * (np.abs(vx) < half)
            col = col * (1 - (m * a)[..., None]) + 255 * (m * a)[..., None]
        # lighting: soft key from upper-left, rim darkening, small specular
        lx, ly, lz = -0.45, -0.55, 0.70
        lam = np.clip(nx * lx + ny * ly + nz * lz, 0, 1)
        shade = 0.42 + 0.72 * lam
        spec = np.clip(nx * -0.38 + ny * -0.52 + nz * 0.76, 0, 1) ** 28 * 70
        col = np.clip(col * shade[..., None] + spec[..., None], 0, 255)
        alpha = np.clip((1 - rr) * (n / 2), 0, 1) * 255
        ball = Image.fromarray(np.dstack([col, alpha]).astype(np.uint8), "RGBA")
        self.layer.alpha_composite(ball, (int(round(self.p(cx - R))), int(round(self.p(cy - R)))))
        self.circle(cx, cy, R, outline=(10, 16, 28, 255), width=2.0)
        self.circle(cx, cy, R + 1.5, outline=(220, 235, 255, 150), width=1.1)
        # prograde marker
        if prograde is not None:
            mx, my = cx + prograde[0] * R, cy + prograde[1] * R
            pg = (214, 255, 92)
            self.circle(mx, my, 6.5, outline=pg + (255,), width=1.8)
            self.circle(mx, my, 1.3, fill=pg + (255,))
            for ax, ay in ((-1, 0), (1, 0), (0, -1)):
                self.line([(mx + ax * 6.5, my + ay * 6.5), (mx + ax * 12, my + ay * 12)], pg, 1.8)
        # fixed nose marker
        gold = (255, 226, 150)
        self.line([(cx - 24, cy), (cx - 9, cy), (cx, cy + 8), (cx + 9, cy), (cx + 24, cy)], (10, 16, 28), 5.0)
        self.line([(cx - 24, cy), (cx - 9, cy), (cx, cy + 8), (cx + 9, cy), (cx + 24, cy)], gold, 2.6)
        self.circle(cx, cy, 2.2, fill=gold + (255,))
        # top pill: mode + speed
        pw = max(self.tw(mode, 17, "SemiBold"), self.tw(speed, 19, "SemiBold")) + 30
        px, py = cx - pw / 2, cy - ring - 44
        self.panel(px, py, pw, 50, r=10)
        self.text(cx, py + 20, mode, 17, DIM, "SemiBold", anchor="ms")
        self.text(cx, py + 41, speed, 19, WHITE, "SemiBold", anchor="ms")
        # bottom pill: heading
        hs = f"{hdg:03d}\u00b0"
        hw = self.tw("HDG", 13, "SemiBold", 1.2) + 8 + self.tw(hs, 19, "SemiBold") + 26
        hx, hy = cx - hw / 2, cy + ring - 6
        self.panel(hx, hy, hw, 30, r=9)
        self.text(hx + 13, hy + 21, "HDG", 13, DIM, "SemiBold", track=1.2)
        self.text(hx + hw - 13, hy + 22, hs, 19, WHITE, "SemiBold", anchor="rs")
        # SAS mode column
        bx = cx + ring + 34
        for i in range(4):
            by = cy - 51 + i * 34
            on = i == sas
            c = GREEN if on else DIM
            self.gd.ellipse([self.p(bx - 14), self.p(by - 14), self.p(bx + 14), self.p(by + 14)], fill=255)
            self.circle(bx, by, 14, outline=c + (255 if on else 120,), width=1.6 if on else 1.1)
            if i == 0:      # prograde
                self.circle(bx, by, 5, outline=c + (255,), width=1.6)
                for ax, ay in ((-1, 0), (1, 0), (0, -1)):
                    self.line([(bx + ax * 5, by + ay * 5), (bx + ax * 9, by + ay * 9)], c, 1.6)
            elif i == 1:    # retrograde
                self.circle(bx, by, 5.5, outline=c + (255,), width=1.6)
                self.line([(bx - 3.6, by - 3.6), (bx + 3.6, by + 3.6)], c, 1.6)
                self.line([(bx - 3.6, by + 3.6), (bx + 3.6, by - 3.6)], c, 1.6)
            elif i == 2:    # hold attitude (stability)
                self.line([(bx - 7, by), (bx - 2.5, by), (bx, by + 3.5), (bx + 2.5, by), (bx + 7, by)], c, 1.7)
                self.line([(bx, by - 7), (bx, by - 3)], c, 1.7)
            else:           # target
                self.circle(bx, by, 5.5, outline=c + (255,), width=1.6)
                self.circle(bx, by, 1.6, fill=c + (255,))
                for ax, ay in ((-1, 0), (1, 0), (0, -1), (0, 1)):
                    self.line([(bx + ax * 5.5, by + ay * 5.5), (bx + ax * 9, by + ay * 9)], c, 1.6)

    def vehicle(self, kind, name, cls, fuel, ox, integrity=1.0, right=1892, bottom=1056):
        tw_, th_, pw = 112, 124, 348
        px, y = right - pw, bottom - th_
        x = right - tw_
        self.panel(px, y, pw, th_, r=10)
        self.line([(x, y + 12), (x, y + th_ - 12)], (190, 215, 255), 1.0, 46)
        cx, cy = x + tw_ / 2 + (4 if kind == "carrier" else 0), y + 54
        ic = (206, 228, 255, 255)
        P = lambda pts: self.poly([(cx + a, cy + b) for a, b in pts], ic)
        if kind == "carrier":       # side profile, bow to the right
            k = 0.92
            P([(a * k, b * k) for a, b in [(-42, -4), (34, -4), (46, 2), (34, 9), (-42, 9)]])
            P([(a * k, b * k) for a, b in [(16, -4), (19, -17), (30, -17), (34, -4)]])
            P([(a * k, b * k) for a, b in [(-49, -8), (-42, -8), (-42, 13), (-49, 13)]])
            P([(a * k, b * k) for a, b in [(-30, -9), (-8, -9), (-6, -4), (-32, -4)]])
            self.line([(cx + 25 * k, cy - 17 * k), (cx + 25 * k, cy - 27 * k)], ic[:3], 1.8)
            self.poly([(cx - 22 * k, cy - 0 * k), (cx + 6 * k, cy - 0 * k), (cx + 6 * k, cy + 6 * k), (cx - 22 * k, cy + 6 * k)], (255, 186, 92, 255))
            for ey in (-7, 4):
                self.poly([(cx - 57 * k, cy + ey * k), (cx - 50 * k, cy + ey * k), (cx - 50 * k, cy + (ey + 8) * k), (cx - 57 * k, cy + (ey + 8) * k)], CYAN + (255,))
        elif kind == "plane":       # top view, nose up
            P([(0, -40), (5, -26), (7, -4), (36, 22), (36, 28), (8, 24), (6, 34), (-6, 34), (-8, 24), (-36, 28), (-36, 22), (-7, -4), (-5, -26)])
            P([(-13, 24), (-9, 12), (-9, 36), (-13, 36)])
            P([(13, 24), (9, 12), (9, 36), (13, 36)])
            for ex in (-5, 2):
                self.poly([(cx + ex, cy + 35), (cx + ex + 3.4, cy + 35), (cx + ex + 3.4, cy + 40), (cx + ex, cy + 40)], CYAN + (255,))
        else:                       # lander, front view
            P([(-15, -22), (15, -22), (22, -10), (22, 6), (14, 13), (-14, 13), (-22, 6), (-22, -10)])
            P([(-6, 13), (6, 13), (9, 22), (-9, 22)])
            self.line([(cx, cy - 22), (cx, cy - 36)], ic[:3], 2.2)
            self.circle(cx, cy - 37, 2.4, fill=ic)
            for s in (-1, 1):
                self.line([(cx + s * 18, cy + 4), (cx + s * 37, cy + 30)], ic[:3], 3.0)
                self.line([(cx + s * 12, cy + 12), (cx + s * 31, cy + 21)], ic[:3], 2.0)
                self.line([(cx + s * 30, cy + 31), (cx + s * 44, cy + 31)], ic[:3], 3.2)
            self.rrect(cx - 9, cy - 13, 18, 9, 2, fill=(24, 44, 76, 255))
        self.bar(x + 16, y + th_ - 18, tw_ - 32, 6, integrity, GREEN)
        # name + propellant gauges, left part of the panel
        gx = px + 20
        self.text(gx, y + 33, name, 21, WHITE, "SemiBold", track=1.4)
        self.text(x - 18, y + 33, cls, 15, DIM, anchor="rs")
        for i, (lab, frac, colr) in enumerate((("FUEL", fuel, AMBER), ("OX", ox, CYAN))):
            yy = y + 72 + i * 30
            self.text(gx, yy, lab, 14, DIM, "SemiBold", track=1.2)
            self.bar(gx + 50, yy - 9, 104, 6, frac, colr, back=(255, 255, 255, 60))
            self.text(x - 18, yy + 1, f"{round(frac * 100)}%", 17, WHITE, "SemiBold", anchor="rs")

    def _crystal(self, cx, cy, s=1.0):
        a = (120, 214, 255, 255); b = (58, 150, 235, 255); c = (176, 236, 255, 255)
        self.poly([(cx - 14 * s, cy + 14 * s), (cx - 6 * s, cy - 4 * s), (cx + 2 * s, cy + 14 * s)], b)
        self.poly([(cx - 4 * s, cy + 14 * s), (cx + 4 * s, cy - 16 * s), (cx + 12 * s, cy + 14 * s)], a)
        self.poly([(cx + 4 * s, cy - 16 * s), (cx + 12 * s, cy + 14 * s), (cx + 6 * s, cy + 14 * s)], b)
        self.poly([(cx + 6 * s, cy + 14 * s), (cx + 13 * s, cy + 0 * s), (cx + 19 * s, cy + 14 * s)], c)

    def _drop(self, cx, cy, color, s=1.0):
        r = 11 * s
        pts = [(cx, cy - 20 * s)]
        for a in range(-35, 216, 6):
            pts.append((cx + r * math.cos(math.radians(a)), cy + 4 * s + r * math.sin(math.radians(a))))
        self.poly(pts, color + (255,))
        self.d.arc([self.p(cx - 6.5 * s), self.p(cy - 2.5 * s), self.p(cx + 6.5 * s), self.p(cy + 10.5 * s)], 100, 170,
                   fill=(255, 255, 255, 215), width=max(1, round(self.p(1.8 * s))))

    def _arrow(self, x, y, color=DIM):
        self.line([(x - 13, y), (x + 11, y)], color, 2.0)
        self.line([(x + 5, y - 6), (x + 12, y), (x + 5, y + 6)], color, 2.0)

    def refinery(self, ore, fuel, ox, cap=100, progress=0.58, cx=960, bottom=1050):
        w, h = 760, 128
        x, y = cx - w / 2, bottom - h
        self.panel(x, y, w, h, r=12)
        mid = y + 50

        def cell(ccx, icon, label, val, color=None):
            if icon == "ore": self._crystal(ccx - 3, mid - 6)
            else: self._drop(ccx, mid - 2, color)
            self.text(ccx, y + 92, label, 17, DIM, anchor="ms")
            self.text(ccx, y + 114, f"{val} / {cap}", 19, WHITE, "SemiBold", anchor="ms")

        cell(x + 76, "ore", "Ore", ore)
        self._arrow(x + 158, mid)
        bx, bw = x + 198, 250
        self.text(bx, mid - 12, "Refining\u2026", 21, WHITE, "SemiBold")
        self.text(bx + bw, mid - 12, f"{round(progress * 100)}%", 19, CYAN, "SemiBold", anchor="rs")
        self.bar(bx, mid + 2, bw, 8, progress, CYAN, back=(255, 255, 255, 48))
        self.text(bx, y + 104, "0.45 Fuel + 0.55 Ox per Ore", 15, FAINT)
        self._arrow(x + 488, mid)
        cell(x + 566, "drop", "Fuel", fuel, AMBER)
        self.text(x + 626, mid + 8, "+", 26, DIM, "SemiBold", anchor="ms")
        cell(x + 686, "drop", "Oxidizer", ox, CYAN)

    def toast(self, x, y, label, value):
        w = self.tw(label, 19) + self.tw(value, 19, "SemiBold") + 86
        self.panel(x, y, w, 44, r=9)
        self._crystal(x + 24, y + 22, 0.62)
        self.text(x + 48, y + 29, label, 19, WHITE)
        self.text(x + w - 16, y + 29, value, 19, CYAN, "SemiBold", anchor="rs")

    def marker(self, x, y, label, sub=None, color=CYAN, side="right"):
        """Small in-world target marker: diamond + leader + label."""
        s = 9
        pts = [(x, y - s), (x + s, y), (x, y + s), (x - s, y), (x, y - s)]
        self.line(pts, (6, 12, 22), 4.0, 150)
        self.line(pts, color, 1.8)
        sgn = 1 if side == "right" else -1
        self.line([(x + sgn * (s + 5), y), (x + sgn * (s + 26), y)], color, 1.4, 200)
        tx = x + sgn * (s + 34)
        anc = "l" if side == "right" else "r"
        self.text(tx, y + (6 if not sub else -2), label, 16, WHITE, "SemiBold", anchor=anc + "s", track=1.4)
        if sub:
            self.text(tx, y + 17, sub, 15, DIM, anchor=anc + "s")

    # ---------- composite ----------
    def render(self):
        base = self.base
        glass = self.glass.resize((self.W, self.H), Image.LANCZOS)
        blur = base.filter(ImageFilter.GaussianBlur(self.W / 1920 * 14))
        tint = Image.blend(blur, Image.new("RGB", base.size, PANEL), 0.78)
        out = Image.composite(tint, base, glass)
        sh = self.shadow.filter(ImageFilter.GaussianBlur(self.p(2.2))).resize((self.W, self.H), Image.LANCZOS)
        out = Image.composite(Image.new("RGB", base.size, (0, 4, 10)), out, sh.point(lambda v: int(v * 0.75)))
        layer = self.layer.resize((self.W, self.H), Image.LANCZOS)
        out = out.convert("RGBA")
        out.alpha_composite(layer)
        return out.convert("RGB")
