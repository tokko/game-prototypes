# Kestrel-class scout engine: geometry source. Executed inside the Blender MCP session
# (exec(open(path).read())). All coordinates below are GAME coordinates
# (x = walker's left, y = up, z = forward, metres); g2b() converts to Blender (x, -y fwd, z up).
import bpy, bmesh, math
from mathutils import Vector, Matrix, Euler

HP = math.pi / 2
H = 14.6                      # hip height at rest
THIGH, SHIN, META, FOOT_H = 6.6, 6.4, 6.2, 1.5
HIP_X, FOOT_X = 3.28, 4.0
ARM_S, TOP_S = 0.82, 0.82      # weapons are modelled at full size and scaled so they do not overpower the hull
MATNAMES = ['hull', 'hull2', 'dark', 'trim', 'bone', 'soot', 'tank', 'glow', 'glow_hot', 'nozzle_inner']
C3 = Matrix(((1, 0, 0), (0, 0, -1), (0, 1, 0)))   # game -> blender

def g2b(v): return Vector((v[0], -v[2], v[1]))

class Part:
    def __init__(self, name):
        self.name = name; self.bm = bmesh.new(); self.n = 0; self.F = Matrix.Identity(4); self.B = Matrix.Identity(4); self.S = 1.0
    def at(self, x=0, y=0, z=0, rx=0, ry=0, rz=0):
        self.F = self.B @ Matrix.Translation((x, y, z)) @ Euler((rx, ry, rz), 'XYZ').to_matrix().to_4x4(); return self
    def _emit(self, verts, faces, mat, M, bev=0.0, flip=False):
        tmp = bmesh.new(); M = Matrix.Scale(self.S, 4) @ self.F @ M
        vs = [tmp.verts.new(M @ Vector(v)) for v in verts]
        for f in faces:
            try: tmp.faces.new([vs[i] for i in f])
            except ValueError: pass
        bmesh.ops.recalc_face_normals(tmp, faces=tmp.faces)
        if flip: bmesh.ops.reverse_faces(tmp, faces=tmp.faces)
        if bev > 0: bmesh.ops.bevel(tmp, geom=list(tmp.edges), offset=bev, segments=1, affect='EDGES', profile=0.5)
        mi = MATNAMES.index(mat); self.n += 1
        jit = 0.88 + 0.24 * ((self.n * 0.6180339) % 1.0)      # per-plate value variation
        me = bpy.data.meshes.new('tmp'); tmp.to_mesh(me); tmp.free()
        for p in me.polygons: p.material_index = mi
        ca = me.color_attributes.new('Color', 'FLOAT_COLOR', 'CORNER')
        for d in ca.data: d.color = (jit, jit, jit, 1)
        for v in me.vertices: v.co = g2b(v.co)
        self.bm.from_mesh(me); bpy.data.meshes.remove(me)
        return self
    def box(self, mat, w, h, d, x, y, z, rx=0, ry=0, rz=0, bev=0.0, tx=1.0, tz=1.0, sx=0.0, sz=0.0, fz=1.0):
        # tx/tz scale the top face, sx/sz shear it, fz scales the width of the front (+z) end: wedges and sloped plates
        hw, hh, hd = w / 2, h / 2, d / 2
        vb = [(-hw, -hh, -hd), (hw, -hh, -hd), (hw, -hh, hd), (-hw, -hh, hd)]
        vt = [(-hw * tx + sx, hh, -hd * tz + sz), (hw * tx + sx, hh, -hd * tz + sz), (hw * tx + sx, hh, hd * tz + sz), (-hw * tx + sx, hh, hd * tz + sz)]
        faces = [(0, 1, 2, 3), (4, 7, 6, 5), (0, 4, 5, 1), (1, 5, 6, 2), (2, 6, 7, 3), (3, 7, 4, 0)]
        M = Matrix.Translation((x, y, z)) @ Euler((rx, ry, rz), 'XYZ').to_matrix().to_4x4()
        vs = [(v[0] * (fz if v[2] > 0 else 1.0), v[1], v[2]) for v in vb + vt]
        return self._emit(vs, faces, mat, M, bev)
    def cyl(self, mat, r1, r2, h, x, y, z, rx=0, ry=0, rz=0, seg=10, bev=0.0, caps=True, flip=False):
        vs = []; faces = []
        for r, yy in ((r2, -h / 2), (r1, h / 2)):
            for i in range(seg):
                a = 2 * math.pi * i / seg + math.pi / seg
                vs.append((math.cos(a) * r, yy, math.sin(a) * r))
        for i in range(seg):
            j = (i + 1) % seg; faces.append((i, j, seg + j, seg + i))
        if caps is True or caps == 'bottom': faces.append(tuple(range(seg)))
        if caps is True or caps == 'top': faces.append(tuple(range(2 * seg - 1, seg - 1, -1)))
        M = Matrix.Translation((x, y, z)) @ Euler((rx, ry, rz), 'XYZ').to_matrix().to_4x4()
        return self._emit(vs, faces, mat, M, bev, flip)
    def torus(self, mat, R, r, x, y, z, rx=0, ry=0, rz=0, seg=12, tseg=4):
        vs = []; faces = []
        for i in range(seg):
            a = 2 * math.pi * i / seg
            for j in range(tseg):
                b = 2 * math.pi * j / tseg + math.pi / 4
                q = R + r * math.cos(b); vs.append((math.cos(a) * q, math.sin(a) * q, r * math.sin(b)))
        for i in range(seg):
            for j in range(tseg):
                i2 = (i + 1) % seg; j2 = (j + 1) % tseg
                faces.append((i * tseg + j, i2 * tseg + j, i2 * tseg + j2, i * tseg + j2))
        M = Matrix.Translation((x, y, z)) @ Euler((rx, ry, rz), 'XYZ').to_matrix().to_4x4()
        return self._emit(vs, faces, mat, M)
    def build(self, coll):
        old = bpy.data.objects.get(self.name)
        if old:
            m = old.data; bpy.data.objects.remove(old, do_unlink=True)
            if m and m.users == 0: bpy.data.meshes.remove(m)
        me = bpy.data.meshes.new(self.name)
        self.bm.to_mesh(me); self.bm.free()
        for n in MATNAMES: me.materials.append(bpy.data.materials[n])
        ob = bpy.data.objects.new(self.name, me); coll.objects.link(ob)
        return ob

def empty(name, coll, size=0.8):
    old = bpy.data.objects.get(name)
    if old: bpy.data.objects.remove(old, do_unlink=True)
    e = bpy.data.objects.new(name, None); e.empty_display_size = size; e.empty_display_type = 'ARROWS'; coll.objects.link(e); return e

# ------------------------------------------------------------------ parts
TILT = 0.16                                   # the whole upper hull is canted nose-down over the hips
def tl(x, y, z):                              # a point in the canted hull frame -> torso space
    return Vector((x, y * math.cos(TILT) - z * math.sin(TILT), y * math.sin(TILT) + z * math.cos(TILT)))

def pelvis():
    p = Part('pelvis')
    p.box('dark', 3.8, 2.2, 3.8, 0, 0, 0, bev=.2, tx=.88, tz=.88)
    p.cyl('dark', 1.05, 1.05, 4.6, 0, 0, 0, rz=HP, seg=10)
    for s in (1, -1):
        p.cyl('trim', 1.6, 1.6, .4, s * 2.1, 0, 0, rz=HP, seg=12)
        p.box('dark', .8, .9, 3.0, s * 1.4, -1.15, -.2, bev=.1)
    p.box('trim', 4.1, .35, 4.1, 0, 1.25, 0, bev=.08)
    p.box('bone', 1.3, 3.0, .4, 0, -2.1, 2.05, tx=1.6, bev=.08)           # groin plate
    p.box('dark', .95, .95, .3, 0, -1.8, 2.28, rz=math.pi / 4)            # Vigil diamond
    p.box('dark', 2.2, 1.5, 2.8, 0, -1.65, -.3, bev=.15, tx=1.15)         # gyro housing
    p.box('dark', 2.0, 1.5, 3.6, 0, .15, -3.2, bev=.16, tz=.6, sz=.3)     # counterweight tail
    p.box('hull', 1.5, .4, 3.0, 0, .98, -3.1, bev=.08, tz=.7)
    p.box('soot', 1.5, .8, .3, 0, .1, -5.0)
    return p

def torso():
    t = Part('torso')
    t.cyl('dark', 2.1, 2.35, 1.3, 0, .55, 0, seg=12)
    t.cyl('trim', 2.5, 2.5, .3, 0, 1.2, 0, seg=12)
    t.B = Euler((TILT, 0, 0), 'XYZ').to_matrix().to_4x4(); t.at()
    t.box('dark', 3.6, 1.4, 7.6, 0, 1.9, .8, bev=.15, tx=1.2, fz=.75)                  # keel
    t.box('hull', 5.6, 2.5, 7.8, 0, 3.6, .8, bev=.22, tx=.88, fz=.68)                  # main hull, tapering to the nose
    t.box('dark', 4.8, 3.0, 2.8, 0, 3.5, -4.0, bev=.2, tz=.75, sz=.3)                  # engine block
    t.box('dark', 3.2, 1.9, 3.8, 0, 2.5, 5.6, bev=.15, fz=.8)                          # collar
    # carapace: three overlapping shells, widest at the shoulders, wedge nose over the head
    t.box('hull', 6.6, .8, 3.6, 0, 4.95, -3.4, rx=-.3, bev=.18, tx=.86, fz=1.15)
    t.box('hull', 8.0, .9, 4.6, 0, 5.45, .3, bev=.2, tx=.84, fz=.88)
    t.box('hull', 7.2, .8, 5.8, 0, 4.7, 4.9, rx=.34, bev=.18, tx=.84, fz=.5)
    for s in (1, -1):
        t.box('trim', .38, .5, 4.6, s * 3.72, 5.2, .3, ry=-s * .1, bev=.06)
        t.box('hull', .7, 2.1, 5.6, s * 3.0, 3.9, .2, rz=-s * .2, bev=.12)             # flank skirts
    t.at(0, 4.7, 4.9, rx=.34)                                                           # front shell frame
    t.box('trim', 3.7, .45, .4, 0, -.1, 2.85, bev=.06)                                  # lip rim
    t.box('hull2', 1.8, .2, 5.0, 0, .45, -.1, fz=.6)                                    # livery stripe
    for s in (1, -1): t.box('dark', .4, .32, 3.8, s * 1.9, .45, -.4, ry=-s * .28, bev=.05)
    t.at()
    t.box('hull2', 2.0, .2, 4.2, 0, 5.92, .3)
    t.box('dark', 1.2, .3, 1.2, 0, 6.0, .3, ry=math.pi / 4)                             # diamond
    for z in (-1.5, 2.1): t.box('dark', 8.2, .85, .36, 0, 5.62, z, tx=.72, bev=.08)     # buttress ribs
    for s in (1, -1):
        t.cyl('dark', 1.1, 1.1, 2.4, s * 3.6, 3.0, .6, rz=HP, seg=10)                  # arm trunnions
        t.cyl('trim', 1.38, 1.38, .32, s * 2.85, 3.0, .6, rz=HP, seg=10)
        t.box('dark', .9, .9, 1.4, s * 2.1, 2.5, 7.0, bev=.1)                           # lamp pods
        t.box('glow', .6, .5, .2, s * 2.1, 2.5, 7.75)
        t.cyl('soot', .38, .46, 3.0, s * 1.6, 6.0, -4.6, rx=-.5, seg=8)                # exhaust stacks
        t.cyl('trim', .52, .52, .28, s * 1.6, 7.25, -5.3, rx=-.5, seg=8)
        t.cyl('soot', .32, .4, 2.3, s * .55, 5.8, -4.9, rx=-.5, seg=8)
    t.box('soot', 3.6, 1.8, .35, 0, 3.4, -5.45, rx=.1)                                  # reactor grille
    for i in range(3): t.box('glow_hot', 3.0, .2, .2, 0, 2.85 + i * .55, -5.66 + i * .05)
    t.box('dark', .22, 2.6, .22, 0, 6.5, -3.6); t.box('trim', .5, .22, .5, 0, 7.8, -3.6)    # sensor mast
    t.B = Matrix.Identity(4); t.at()
    return t

def head():
    h = Part('head')
    h.cyl('dark', 1.0, 1.0, 2.2, 0, .1, -.7, rx=HP, seg=8)                               # neck
    h.box('hull', 3.3, 2.2, 4.2, 0, 0, 1.7, bev=.2, tx=.82, tz=.8, sz=-.35, fz=.72)      # skull
    h.box('dark', 2.8, 1.2, 3.0, 0, -1.3, 1.9, bev=.12, tx=1.1, fz=.8)                   # jaw
    h.box('trim', 3.0, .45, 1.7, 0, .72, 3.05, rx=.3, bev=.1, fz=.85)                    # brow
    h.box('soot', 2.5, .6, .3, 0, .12, 3.72)
    for s in (1, -1):
        h.box('glow', .85, .26, .2, s * .7, .12, 3.86)                                   # eye slits
        h.cyl('dark', .5, .5, .9, s * 1.85, -.3, 1.2, rz=HP, seg=8)                      # cheek pods
        h.box('trim', .28, 1.4, .28, s * 1.2, -1.3, 3.3, bev=.05)
    h.box('soot', 2.2, .95, .25, 0, -1.3, 3.34)                                          # portcullis grille
    for i in range(-2, 3): h.box('trim', .15, 1.0, .2, i * .4, -1.3, 3.5)
    h.box('hull2', .65, .5, 3.2, 0, 1.25, 1.2, tz=.8, sz=-.2, bev=.06)                   # crest
    h.box('dark', .14, 1.7, .14, 1.25, 1.6, .2)
    return h

def arm_l():
    a = Part('arm_L'); a.S = ARM_S
    a.box('hull', 2.6, 2.9, 5.2, 0, 0, .2, bev=.15)
    a.cyl('dark', 1.5, 1.5, 2.3, -.2, -.3, -2.4, rz=HP, seg=10)
    a.box('trim', 2.9, .4, 3.4, 0, -1.65, .2, bev=.06)
    a.box('hull2', 2.7, .9, 1.3, 0, -.6, 1.95)                                           # livery band
    for z in (-1, 0, 1): a.box('soot', .25, 1.9, .5, 1.4, .1, z)
    # three pressurised fuel tanks: two on top, one outboard
    for (x, y, r, L, z0) in ((-.85, 2.35, .95, 4.6, -.2), (.95, 2.35, .95, 4.6, -.2), (2.25, .5, .85, 4.0, -.4)):
        a.cyl('tank', r, r, L, x, y, z0, rx=HP, seg=10)
        a.cyl('dark', r + .08, r + .08, .35, x, y, z0 - L / 2 + .9, rx=HP, seg=10)
        a.cyl('dark', r + .08, r + .08, .35, x, y, z0 + L / 2 - .9, rx=HP, seg=10)
        a.cyl('trim', r * .58, r, .5, x, y, z0 + L / 2 + .25, rx=HP, seg=10)
    for x in (-.85, .95):
        a.box('trim', .5, .7, .5, x, 3.5, -1.0); a.box('dark', 1.1, .2, .2, x, 3.9, -1.0)   # valve wheels
        a.box('soot', .6, .6, 2.7, x * .75, 1.72, 3.5, rx=.5)                                 # hoses
        a.cyl('trim', .35, .35, .5, x, 2.3, 2.7, rx=HP, seg=6)
    a.box('soot', .5, .5, 2.6, 1.7, .3, 3.0, ry=-.5)
    a.box('dark', .9, .9, .25, .1, 3.3, 1.6); a.box('glow', .5, .5, .12, .1, 3.3, 1.76)      # gauge
    # the lance
    a.cyl('dark', .82, .95, 5.2, 0, 0, 5.2, rx=HP, seg=10)
    a.cyl('trim', 1.15, 1.15, .5, 0, 0, 3.4, rx=HP, seg=10)
    a.cyl('trim', 1.1, 1.1, .45, 0, 0, 5.4, rx=HP, seg=10)
    a.cyl('dark', 1.05, 1.05, .4, 0, 0, 7.2, rx=HP, seg=10)
    # hollow heat-blackened bell: outer skin, inner skin (own material so the game can make it glow), lip
    a.cyl('soot', 1.8, .85, 2.3, 0, 0, 8.7, rx=HP, seg=12, caps='bottom')
    a.cyl('nozzle_inner', 1.6, .7, 1.9, 0, 0, 8.9, rx=HP, seg=12, caps='bottom', flip=True)
    a.torus('soot', 1.7, .14, 0, 0, 9.85, seg=12)
    a.box('dark', .45, .45, 2.0, 0, -1.95, 9.3); a.cyl('trim', .14, .14, 4.5, -.5, -1.2, 6.6, rx=HP, seg=5)   # igniter
    for sx in (1, -1):
        for sy in (1, -1): a.box('soot', .16, .16, 2.0, sx * 1.24, sy * 1.24, 10.8)
    a.torus('soot', 1.78, .11, 0, 0, 10.7, seg=12); a.torus('soot', 1.78, .11, 0, 0, 11.75, seg=12)
    return a

def arm_r():
    r = Part('arm_R'); r.S = ARM_S
    r.box('hull', 2.7, 3.0, 5.4, 0, 0, 0, bev=.15)
    r.cyl('dark', 1.4, 1.4, 2.2, .2, -.3, -2.6, rz=HP, seg=10)
    r.box('dark', 3.0, .4, 3.6, 0, -1.7, 0, bev=.06)
    r.box('hull2', 2.8, .9, 1.3, 0, -.6, 1.75)
    r.cyl('dark', 1.6, 1.6, 2.2, -.5, 2.2, -1.0, rz=HP, seg=12)                           # ammunition drum
    r.cyl('trim', 1.72, 1.72, .3, -.5, 2.2, -1.0, rz=HP, seg=12)
    r.cyl('trim', .5, .5, 2.5, -.5, 2.2, -1.0, rz=HP, seg=6)
    r.box('dark', 1.3, .7, 2.6, -.3, 1.8, 1.3, rx=.4, bev=.06)                            # feed chute
    r.box('trim', 1.9, .5, 1.5, 0, 1.7, -1.9, bev=.06)
    for z in (-.6, .3, 1.2): r.box('soot', .25, 1.7, .5, -1.4, .1, z)
    return r

def barrel_r():
    b = Part('barrel_R'); b.S = ARM_S
    b.cyl('dark', 1.0, 1.0, 2.6, 0, 0, 3.4, rx=HP, seg=10)
    b.cyl('soot', .72, .8, 8.5, 0, 0, 6.6, rx=HP, seg=10)
    b.cyl('dark', 1.15, 1.15, 3.0, 0, 0, 6.3, rx=HP, seg=8)                               # cooling shroud
    for s in (1, -1):
        b.box('soot', .2, .55, 2.2, s * 1.08, 0, 6.3); b.box('soot', .55, .2, 2.2, 0, s * 1.08, 6.3)
    b.cyl('trim', .95, .95, .35, 0, 0, 8.6, rx=HP, seg=10)
    b.box('dark', 1.9, 1.9, 1.7, 0, 0, 11.2, bev=.14)                                     # muzzle brake
    b.box('soot', 2.0, .5, .4, 0, 0, 10.85); b.box('soot', 2.0, .5, .4, 0, 0, 11.55)
    b.cyl('soot', .6, .6, .1, 0, 0, 12.06, rx=HP, seg=10)
    return b

def rack():
    k = Part('aa_rack'); k.S = TOP_S
    k.box('dark', 2.4, 1.2, 2.4, 0, .3, 0, bev=.1)
    k.at(0, 1.7, .2, rx=-.3)
    k.box('dark', 3.6, 2.0, 4.2, 0, 0, 0, bev=.15)
    k.box('trim', 3.9, .35, 4.4, 0, 1.1, -.2, bev=.08)
    k.box('soot', 3.2, 1.7, .2, 0, 0, 2.1)
    for i in range(6): k.box('glow_hot', .6, .6, .2, (i % 3 - 1) * 1.05, (i // 3) * .8 - .4, 2.2)
    k.box('soot', 3.0, 1.8, .2, 0, 0, -2.12)
    k.at()
    return k

def spear():
    s = Part('sunspear'); s.S = TOP_S
    s.box('dark', 2.0, 1.2, 2.6, 0, .3, 0, bev=.1)
    s.box('dark', 2.2, 2.2, 5.2, 0, 1.6, 0, bev=.15)
    s.box('hull2', 2.25, .8, 1.2, 0, 1.6, 1.4)
    s.cyl('soot', .75, .95, 6.5, 0, 1.7, 4.8, rx=HP, seg=10)
    for z in (2.8, 4.6, 6.4): s.cyl('trim', 1.25, 1.25, .5, 0, 1.7, z, rx=HP, seg=10)
    for q in (1, -1): s.cyl('trim', .5, .5, 4.4, q * 1.4, 1.5, -.3, rx=HP, seg=8)        # capacitors
    s.cyl('dark', .8, .8, 1.0, 0, 1.7, -3.0, rx=HP, seg=8)
    s.cyl('glow', .5, .5, .12, 0, 1.7, 8.1, rx=HP, seg=10)
    return s

def thigh():
    th = Part('thigh')
    th.cyl('dark', 1.5, 1.5, 2.0, 0, 0, 0, rz=HP, seg=12)
    th.cyl('trim', 1.0, 1.0, 2.3, 0, 0, 0, rz=HP, seg=8)
    th.box('hull', 1.6, 2.0, 5.2, 0, 0, 3.3, bev=.16, fz=.85)
    th.box('hull', 2.3, .65, 4.8, 0, 1.25, 3.1, bev=.14, tz=.85, fz=.8)                   # cuisse plate
    th.box('hull2', .8, .2, 3.8, 0, 1.62, 3.1)
    th.cyl('trim', .25, .25, 4.8, 0, -1.2, 3.3, rx=HP, seg=6)
    th.box('dark', .9, .8, 1.2, 0, -1.1, 1.1)
    th.cyl('dark', 1.2, 1.2, 2.2, 0, 0, THIGH, rz=HP, seg=12)                             # knee
    th.box('trim', 2.3, .35, 1.0, 0, 1.15, THIGH - .6, bev=.06)
    return th

def shin():
    sh = Part('shin')
    sh.box('dark', 1.3, 1.5, 5.4, 0, 0, 3.1, bev=.13)
    sh.box('hull', 1.9, .5, 4.2, 0, .95, 3.0, bev=.12, tz=.85)
    for s in (1, -1): sh.cyl('trim', .2, .2, 4.6, s * .38, -.95, 3.2, rx=HP, seg=6)
    sh.cyl('dark', 1.0, 1.0, 1.9, 0, 0, SHIN, rz=HP, seg=10)                              # hock
    sh.box('dark', .9, .9, 1.9, 0, -.5, SHIN + .8, rx=.5, bev=.1, tz=.5, tx=.7)           # hock spur
    return sh

def meta():
    m = Part('meta')
    m.box('dark', 1.1, 1.3, 5.2, 0, 0, 3.1, bev=.12)
    m.box('hull', 1.7, .5, 4.6, 0, .85, 2.9, bev=.12, tz=.8)                              # greave
    m.box('hull2', .6, .15, 3.2, 0, 1.14, 2.9)
    m.cyl('trim', .2, .2, 4.6, 0, -.85, 3.1, rx=HP, seg=6)
    m.cyl('dark', .9, .9, 1.7, 0, 0, META, rz=HP, seg=10)                                 # ankle
    return m

def foot():
    f = Part('foot')
    f.box('dark', 2.4, 1.4, 2.6, 0, 1.0, 0, bev=.15, tx=.8, tz=.8)
    f.box('dark', 3.0, .4, 3.2, 0, .2, .2, bev=.06)
    for s in (1, -1):
        f.box('hull', 1.3, 1.0, 4.4, s * 1.05, .5, 2.85, ry=s * .2, bev=.12, tz=.62, sz=-.75, tx=.8)   # fore toes
        f.box('soot', .95, .5, .9, s * 1.45, .25, 4.9, ry=s * .2)
    f.box('hull', 1.3, .9, 2.6, 0, .45, -2.3, bev=.12, tz=.6, sz=.45, tx=.8)                           # heel spur
    return f

# ------------------------------------------------------------------ assemble
def look_basis(frm, to, up=Vector((0, 0, 1))):
    z = (Vector(to) - Vector(frm)).normalized(); x = up.cross(z).normalized(); y = z.cross(x)
    return Matrix((x, y, z)).transposed()      # columns = local axes in game space

def place(ob, pos, Rg=None):
    Rb = (C3 @ (Rg or Matrix.Identity(3)) @ C3.transposed()).to_4x4()
    ob.matrix_world = Matrix.Translation(g2b(pos)) @ Rb

def build_all():
    coll = bpy.data.collections.get('ScoutWalker')
    if not coll:
        coll = bpy.data.collections.new('ScoutWalker'); bpy.context.scene.collection.children.link(coll)
    for o in list(coll.objects):
        m = o.data; bpy.data.objects.remove(o, do_unlink=True)
        if m and isinstance(m, bpy.types.Mesh) and m.users == 0: bpy.data.meshes.remove(m)
    root = empty('walker', coll, 2.0)
    T = Vector((0, H + 1.2, 0))                                   # waist pivot (world)
    P = {}
    spec = [   # name, builder, parent, world origin (game coords)
        ('pelvis', pelvis, 'walker', (0, H, 0)), ('torso', torso, 'pelvis', T),
        ('head', head, 'torso', T + tl(0, 2.2, 7.9)),
        ('arm_L', arm_l, 'torso', T + tl(5.3, 3.0, .6)), ('arm_R', arm_r, 'torso', T + tl(-5.3, 3.0, .6)),
        ('barrel_R', barrel_r, 'arm_R', T + tl(-5.3, 3.0, .6)),
        ('aa_rack', rack, 'torso', T + tl(2.2, 5.8, -1.9)), ('sunspear', spear, 'torso', T + tl(-2.2, 5.8, -2.1)),
    ]
    P['walker'] = root
    for name, fn, par, org in spec:
        ob = fn().build(coll); place(ob, org); P[name] = ob
    A = ARM_S; Q = TOP_S
    for name, par, org in (('anchor_nozzle', 'arm_L', (0, 0, 10.0 * A)), ('anchor_pilot', 'arm_L', (0, -1.7 * A, 10.7 * A)),
                           ('anchor_muzzle', 'arm_R', (0, 0, 12.4 * A)), ('anchor_rack', 'aa_rack', (0, 2.35 * Q, 2.6 * Q)),
                           ('anchor_lance', 'sunspear', (0, 1.7 * Q, 8.5 * Q)), ('anchor_lamp', 'torso', tuple(tl(0, 2.5, 8.6)))):
        e = empty(name, coll); pw = P[par].matrix_world.translation
        e.matrix_world = Matrix.Translation(pw + g2b(org)); P[name] = e; spec.append((name, None, par, None))
    # legs: one mesh per segment, shared by both sides, posed in the rest stance with the game's IK maths
    segs = {n: fn().build(coll) for n, fn in (('thigh', thigh), ('shin', shin), ('meta', meta), ('foot', foot))}
    fwd = Vector((0, 0, 1)); th0 = 0.5
    for side, tag, fz in ((1, 'L', .9), (-1, 'R', -.9)):
        hip = Vector((side * HIP_X, H, 0)); fpos = Vector((side * FOOT_X, 0, fz)); ank = fpos + Vector((0, FOOT_H, 0))
        hock = ank + META * Vector((0, math.cos(th0), -math.sin(th0)))
        d = hock - hip; L = d.length; d.normalize()
        a = math.acos(max(-1, min(1, (THIGH * THIGH + L * L - SHIN * SHIN) / (2 * THIGH * L))))
        bend = fwd - d * fwd.dot(d); bend.normalize()
        knee = hip + d * math.cos(a) * THIGH + bend * math.sin(a) * THIGH
        for n, frm, to in (('thigh', hip, knee), ('shin', knee, hock), ('meta', hock, ank)):
            if side == 1: ob = segs[n]; ob.name = n + '_L'
            else: ob = bpy.data.objects.new(n + '_R', segs[n].data); coll.objects.link(ob)
            place(ob, frm, look_basis(frm, to)); P[ob.name] = ob; spec.append((ob.name, None, 'walker', None))
        if side == 1: ob = segs['foot']; ob.name = 'foot_L'
        else: ob = bpy.data.objects.new('foot_R', segs['foot'].data); coll.objects.link(ob)
        place(ob, fpos); P[ob.name] = ob; spec.append((ob.name, None, 'walker', None))
    bpy.context.view_layer.update()
    for name, fn, par, org in spec:
        ob = P[name]; mw = ob.matrix_world.copy(); ob.parent = P[par]; ob.matrix_parent_inverse = Matrix.Identity(4)
        ob.matrix_world = mw
    bpy.context.view_layer.update()
    tris = 0; per = {}
    seen = set()
    for o in coll.objects:
        if o.type != 'MESH': continue
        n = sum(len(p.vertices) - 2 for p in o.data.polygons); per[o.name] = n; tris += n
    return {'tris_total_both_legs': tris, 'per': per}

# ------------------------------------------------------------------ bake / render / export (run after build_all)
def bake_ao(samples=48):
    sc = bpy.context.scene; coll = bpy.data.collections['ScoutWalker']
    sc.render.engine = 'CYCLES'; sc.cycles.device = 'CPU'; sc.cycles.samples = samples; sc.render.bake.target = 'VERTEX_COLORS'
    done = set()
    for o in coll.objects:
        if o.type != 'MESH' or o.data.name in done: continue
        done.add(o.data.name); me = o.data
        ao = me.color_attributes.new('AO', 'FLOAT_COLOR', 'CORNER'); me.color_attributes.active_color = ao
        bpy.ops.object.select_all(action='DESELECT'); o.select_set(True); bpy.context.view_layer.objects.active = o
        bpy.ops.object.bake(type='AO')
        col = me.color_attributes['Color']; ao = me.color_attributes['AO']
        for i in range(len(col.data)):
            v = col.data[i].color[0] * (0.3 + 0.7 * ao.data[i].color[0]); col.data[i].color = (v, v, v, 1)
        me.color_attributes.remove(me.color_attributes['AO'])
        me.color_attributes.active_color = me.color_attributes['Color']; me.color_attributes.render_color_index = 0

def shot(path, az, el=0.12, dist=70, tgt=(0, 0, 11.5), samples=48):
    sc = bpy.context.scene; cam = bpy.data.objects['Cam']; t = Vector(tgt)
    p = t + Vector((math.sin(az) * math.cos(el), -math.cos(az) * math.cos(el), math.sin(el))) * dist
    cam.location = p; cam.rotation_euler = (t - p).to_track_quat('-Z', 'Y').to_euler()
    sc.cycles.samples = samples; sc.render.filepath = path; bpy.ops.render.render(write_still=True)

def export_glb(path):
    coll = bpy.data.collections['ScoutWalker']
    bpy.ops.object.select_all(action='DESELECT')
    for o in coll.objects: o.select_set(True)
    bpy.context.view_layer.objects.active = bpy.data.objects['walker']
    bpy.ops.export_scene.gltf(filepath=path, export_format='GLB', use_selection=True, export_yup=True, export_apply=False, export_animations=False,
                              export_texcoords=False, export_normals=True, export_materials='EXPORT', export_vertex_color='ACTIVE')
