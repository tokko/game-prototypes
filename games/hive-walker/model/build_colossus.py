# Great Colossus: geometry source, executed inside the Blender MCP session (exec(open(path).read(), globals())).
# Self-contained: carries the Part helper family of build_scout.py / build_hierarch.py (g2b, C3, Part, empty, look_basis, place,
# MATNAMES, ensure_materials, pyr) plus the spec's `lancet`. GAME coordinates throughout: x = walker's left, y = up, z = forward,
# metres; g2b() converts to Blender (x, -z, y). Spec: model/colossus-visual.md. Run: build_colossus(blockout=True|False).
import bpy, bmesh, math
from mathutils import Vector, Matrix, Euler
from mathutils.bvhtree import BVHTree

HP = math.pi / 2; Q = math.pi / 4; SQ = math.sqrt(2)
BLK = False                      # blockout stage: only primitives tagged [B] (bbox / bcyl / bpyr) are emitted
MATNAMES = ['hull', 'hull2', 'dark', 'trim', 'bone', 'soot', 'tank', 'glow', 'glow_hot', 'glow_charge']
C3 = Matrix(((1, 0, 0), (0, 0, -1), (0, 1, 0)))   # game -> blender
BOXLOG = []                      # (node, mat, w, h, d, tapered, x, y, z) for test Q2
LANCETS = []                     # (node, tag, x, y, z, face, w, h) for test F7
EXEMPT = {(14, 10.5, 10), (3.5, 9.5, 8), (10, 10, 9)}   # nave, transept arms, belfry stage (rule 1 exemptions)

def g2b(v): return Vector((v[0], -v[2], v[1]))

class Part:
    def __init__(self, name):
        self.name = name; self.bm = bmesh.new(); self.n = 0; self.F = Matrix.Identity(4); self.B = Matrix.Identity(4); self.S = 1.0; self._t = False
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
        jit = 0.94 + 0.12 * ((self.n * 0.6180339) % 1.0)       # plate jitter +-6 % (spec section 11)
        me = bpy.data.meshes.new('tmp'); tmp.to_mesh(me); tmp.free()
        for p in me.polygons: p.material_index = mi
        ca = me.color_attributes.new('Color', 'FLOAT_COLOR', 'CORNER')
        for d in ca.data: d.color = (jit, jit, jit, 1)
        for v in me.vertices: v.co = g2b(v.co)
        self.bm.from_mesh(me); bpy.data.meshes.remove(me)
        return self
    def box(self, mat, w, h, d, x, y, z, rx=0, ry=0, rz=0, bev=0.0, tx=1.0, tz=1.0, sx=0.0, sz=0.0, fz=1.0):
        if BLK and not self._t: return self
        tap = bool(rx or ry or rz or tx != 1 or tz != 1 or sx or sz or fz != 1)
        BOXLOG.append((self.name, mat, w, h, d, tap, x, y, z))
        hw, hh, hd = w / 2, h / 2, d / 2
        vb = [(-hw, -hh, -hd), (hw, -hh, -hd), (hw, -hh, hd), (-hw, -hh, hd)]
        vt = [(-hw * tx + sx, hh, -hd * tz + sz), (hw * tx + sx, hh, -hd * tz + sz), (hw * tx + sx, hh, hd * tz + sz), (-hw * tx + sx, hh, hd * tz + sz)]
        faces = [(0, 1, 2, 3), (4, 7, 6, 5), (0, 4, 5, 1), (1, 5, 6, 2), (2, 6, 7, 3), (3, 7, 4, 0)]
        M = Matrix.Translation((x, y, z)) @ Euler((rx, ry, rz), 'XYZ').to_matrix().to_4x4()
        vs = [(v[0] * (fz if v[2] > 0 else 1.0), v[1], v[2]) for v in vb + vt]
        return self._emit(vs, faces, mat, M, bev)
    def cyl(self, mat, r1, r2, h, x, y, z, rx=0, ry=0, rz=0, seg=10, bev=0.0, caps=True, flip=False):
        if BLK and not self._t: return self
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
    def bbox(self, *a, **k): self._t = True; self.box(*a, **k); self._t = False; return self
    def bcyl(self, *a, **k): self._t = True; self.cyl(*a, **k); self._t = False; return self
    def poly(self, mat, outline, thick, plane, wall, centre, yb):    # extruded outline (lancet body); plane 'z' or 'x'
        n = len(outline); vs = []
        for off in (-thick / 2, thick / 2):
            for u, v in outline:
                vs.append((centre + u, yb + v, wall + off) if plane == 'z' else (wall + off, yb + v, centre + u))
        faces = [tuple(range(n)), tuple(range(2 * n - 1, n - 1, -1))] + [(i, (i + 1) % n, n + (i + 1) % n, n + i) for i in range(n)]
        return self._emit(vs, faces, mat, Matrix.Identity(4))
    def build(self, coll):
        old = bpy.data.objects.get(self.name)
        if old:
            m = old.data; bpy.data.objects.remove(old, do_unlink=True)
            if m and isinstance(m, bpy.types.Mesh) and m.users == 0: bpy.data.meshes.remove(m)
        me = bpy.data.meshes.new(self.name)
        self.bm.to_mesh(me); self.bm.free()
        for n in MATNAMES: me.materials.append(bpy.data.materials[n])
        ob = bpy.data.objects.new(self.name, me); coll.objects.link(ob)
        return ob

def pyr(p, mat, w, h, x, yb, z):                 # square spirelet, base at yb (10 tris)
    p.cyl(mat, 0.02, w / SQ, h, x, yb + h / 2, z, seg=4, caps='bottom')
def bpyr(p, *a): p._t = True; pyr(p, *a); p._t = False

def lancet(p, mat, w, h, x, yb, z, face):        # pointed window: pentagon prism 0.5 thick, centred on the wall (0.25 proud)
    if BLK: return
    ol = [(-w / 2, 0), (w / 2, 0), (w / 2, h - 0.9 * w), (0, h), (-w / 2, h - 0.9 * w)]
    LANCETS.append((p.name, 'win', x, yb + h / 2, z, face, w, h))
    if face in ('+z', '-z'): p.poly(mat, ol, 0.5, 'z', z, x, yb)
    else: p.poly(mat, ol, 0.5, 'x', x, z, yb)

def empty(name, coll, size=0.8):
    old = bpy.data.objects.get(name)
    if old: bpy.data.objects.remove(old, do_unlink=True)
    e = bpy.data.objects.new(name, None); e.empty_display_size = size; e.empty_display_type = 'ARROWS'; coll.objects.link(e); return e

def look_basis(frm, to, up=Vector((0, 0, 1))):
    z = (Vector(to) - Vector(frm)).normalized(); x = up.cross(z).normalized(); y = z.cross(x)
    return Matrix((x, y, z)).transposed()      # columns = local axes in game space

def place(ob, pos, Rg=None):
    Rb = (C3 @ (Rg or Matrix.Identity(3)) @ C3.transposed()).to_4x4()
    ob.matrix_world = Matrix.Translation(g2b(pos)) @ Rb

def ensure_materials():
    MATS = {'hull': ((0.275, 0.322, 0.369), 0.62, 0.35), 'hull2': ((0.604, 0.580, 0.494), 0.7, 0.1), 'dark': ((0.114, 0.133, 0.157), 0.6, 0.5),
            'trim': ((0.604, 0.478, 0.227), 0.45, 0.8), 'bone': ((0.604, 0.580, 0.494), 0.8, 0.0), 'soot': ((0.043, 0.039, 0.035), 0.85, 0.2),
            'tank': ((0.478, 0.165, 0.110), 0.55, 0.3), 'glow': ((2.2, 1.3, 0.35), 0.5, 0.0), 'glow_hot': ((2.2, 0.25, 0.1), 0.5, 0.0), 'glow_charge': ((0.6, 1.4, 2.6), 0.5, 0.0)}
    lin = lambda c: tuple(((v / 12.92) if v <= 0.04045 else ((v + 0.055) / 1.055) ** 2.4) for v in c)
    for n, (c, r, m) in MATS.items():
        mt = bpy.data.materials.get(n) or bpy.data.materials.new(n); mt.use_nodes = True; nt = mt.node_tree; nt.nodes.clear()
        out = nt.nodes.new('ShaderNodeOutputMaterial'); b = nt.nodes.new('ShaderNodeBsdfPrincipled'); nt.links.new(b.outputs[0], out.inputs[0])
        if n.startswith('glow'):
            mx = max(c); b.inputs['Base Color'].default_value = (0, 0, 0, 1)
            b.inputs['Emission Color'].default_value = (c[0] / mx, c[1] / mx, c[2] / mx, 1); b.inputs['Emission Strength'].default_value = mx * 2
        else:
            col = nt.nodes.new('ShaderNodeVertexColor'); col.layer_name = 'Color'
            mix = nt.nodes.new('ShaderNodeMix'); mix.data_type = 'RGBA'; mix.blend_type = 'MULTIPLY'; mix.inputs[0].default_value = 1.0
            mix.inputs[6].default_value = (*lin(c), 1)
            nt.links.new(col.outputs['Color'], mix.inputs[7]); nt.links.new(mix.outputs[2], b.inputs['Base Color'])
            b.inputs['Roughness'].default_value = r; b.inputs['Metallic'].default_value = m
    if 'blk' not in bpy.data.materials:
        mt = bpy.data.materials.new('blk'); mt.use_nodes = True; mt.node_tree.nodes['Principled BSDF'].inputs['Base Color'].default_value = (.5, .5, .5, 1)

# ------------------------------------------------------------------ parts (spec section 6)
SG = (1, -1)

def c_pelvis():
    p = Part('pelvis')
    p.bbox('dark', 24, 9, 17, 0, 0, 0, bev=.4, tx=1.10)
    for s in SG: p.bcyl('dark', 7, 7, 10, s * 14, 0, 0, rz=HP, seg=10)
    p.bbox('dark', 13, 8, 13, 0, -6.5, 0, bev=.3, tx=1.23)
    p.bbox('bone', 9, 26, .8, 0, -18, 9.2, tx=.8)
    p.box('trim', 11, 3, 1.6, 0, -4, 9.3)
    p.box('dark', 2, 20, .5, 0, -17.5, 9.8)
    p.box('tank', 5.5, 5.5, .5, 0, -12, 9.9, rz=Q)
    p.box('trim', 9.6, 1.4, 1.2, 0, -31, 9.2)
    p.box('bone', 8, 20, .7, 0, -15, -9, tx=.8)
    p.box('trim', 8.6, 1.2, 1.1, 0, -25, -9)
    for s in SG:
        p.bbox('hull', 1.4, 13, 9.5, s * 19.7, -2.5, 0, rz=s * .12, bev=.3, tz=1.37)
        p.box('bone', .5, 5, 5, s * 20.6, -2, 0, rx=Q)
    p.box('bone', 20, 2.6, .6, 0, 1.2, 8.8)
    return p

def c_torso():
    t = Part('torso')
    # --- hull and breastwork
    t.bcyl('dark', 9, 10.5, 6, 0, 1, 0, seg=10)
    t.bbox('hull', 34, 22, 20, 0, 14, 0, bev=.5, tx=1.18, tz=1.2, sz=1.0)
    t.bbox('dark', 30, 3, 12, 0, 4, 12, fz=.75)
    t.bbox('hull', 26, 9, 10, 0, 8.5, 15, bev=.4, tx=.85, sz=1.0, fz=.8)
    for s in SG: t.bbox('hull', 7.5, 12, 8, s * 9.75, 19, 15.5, bev=.35, tx=.88)
    t.bbox('dark', 28, 2, 10, 0, 26, 15, bev=.3, fz=.8)
    t.box('trim', 22.6, 1.0, .8, 0, 26.3, 20.2)
    for s in SG:
        t.box('dark', 2, 3, 2, s * 9.8, 28.5, 18, bev=.15); pyr(t, 'trim', 2.4, 3, s * 9.8, 30, 18)
        t.cyl('trim', 1.1, 1.1, 12, s * 6.3, 19, 20.2, seg=6)
    for x in (-11.9, -9.75, -7.6, 7.6, 9.75, 11.9): lancet(t, 'glow', 1.5, 5, x, 15.5, 19.5, '+z')
    # --- reliquary on the breastwork front
    t.box('bone', 9, 6.5, .8, 0, 8.5, 20.7, rx=.1)
    t.box('trim', 10.4, .8, 1.0, 0, 12.15, 21.05, rx=.1)
    t.box('trim', 10.4, .8, 1.0, 0, 4.85, 20.35, rx=.1)
    t.box('tank', 4.6, 4.6, .6, 0, 8.5, 21.2, rx=.1, rz=Q)
    t.box('glow', 1.8, 1.8, .5, 0, 8.5, 21.6, rz=Q)
    for s in SG: t.box('bone', 3, 5, .5, s * 6.9, 8, 20.6, rx=.1)
    t.box('glow', 12, .9, .5, 0, 4.2, 18.1)
    # --- carapace deck
    t.bbox('dark', 42, 5, 26, 0, 27, -1, bev=.4, tx=1.071, tz=1.077)
    t.box('trim', 43.4, .8, 27, 0, 25.6, -1)
    for x in (-18.6, -14.9, -11.2, -7.5, 7.5, 11.2, 14.9, 18.6): t.box('dark', 2.2, 1.6, 1.2, x, 30.3, 12.3)
    # --- bastion pauldrons
    for s in SG:
        t.bbox('hull', 15, 13, 27, s * 27.5, 21, 0, bev=.5, tx=.92, tz=.96, sx=s * .6, sz=1.8)
        t.bbox('hull', 15.2, 1.6, 27.4, s * 27.5, 28.2, 1.6)      # visual-gate: cap slab in hull slot
        t.box('trim', .8, 1.0, 27.6, s * 35.2, 28.5, 1.6)
        t.box('trim', 15.4, 1.0, .8, s * 27.5, 28.5, 15.4)
        t.box('trim', 15.4, 1.0, .8, s * 27.5, 28.5, -12.2)
        t.box('bone', 9, 9, .6, s * 27.5, 21, 14.3, rx=.1)
        t.box('tank', 5, 5, .5, s * 27.5, 21, 14.7, rx=.1, rz=Q)
        t.box('glow', 2.4, 2.4, .5, s * 27.5, 21, 15.0, rz=Q)
        # visual-gate: rear boss (mirror of the front) and cap-top plate seen from the pilot camera
        t.box('bone', 9, 9, .6, s * 27.5, 21, -12.5, rx=.18)
        t.box('tank', 5, 5, .5, s * 27.5, 21, -12.9, rx=.18, rz=Q)
        t.box('glow', 2.4, 2.4, .5, s * 27.5, 21, -13.2, rz=Q)
        t.box('bone', 6, .5, 3, s * 26.5, 29.25, -9.6)
        t.box('bone', .6, 8, 5, s * 14.3, 11.75, -14.5, rz=s * .116)      # furnace housing flank plate
        t.box('tank', .5, 3.5, 3.5, s * 14.65, 11.75, -14.5, rx=Q)
        t.box('bone', 6.5, .5, 1.6, s * 9.3, 29.6, -13.9)                 # deck rear edge plate
        for z in (-10, -2.9, 4.1, 11.2): t.box('trim', .7, 12, 1.0, s * 35.2, 21, z)
        for z in (-6.4, .6, 7.6): lancet(t, 'glow', 1.8, 6.5, s * 35, 17.5, z, '+x' if s > 0 else '-x')
        for z in (13.4, -10.4):
            t.bbox('dark', 2.6, 5, 2.6, s * 33.4, 31.5, z, bev=.15); bpyr(t, 'trim', 3.2, 5, s * 33.4, 34, z)
        for z in (-5.6, -1.6, 2.4, 6.4, 10.4): t.box('dark', 1.2, 1.6, 2.4, s * 34.4, 29.8, z)
    # --- carapace battery
    for s in SG:
        t.bbox('dark', 9, 6, 11, s * 27.5, 32, -2, bev=.3, tz=.85)
        t.bcyl('soot', 1.3, 1.5, 16, s * 27.5, 33, 9, rx=HP, seg=8)
        t.cyl('trim', 2, 2, 1.4, s * 27.5, 33, 16.2, rx=HP, seg=8)
        t.box('dark', 3.6, 2.4, 6, s * 27.5, 30.2, 7.5)
    # --- rear reactor: the caged furnace
    t.bbox('hull', 30, FH, 9, 0, FY, -15, bev=.4, tx=.88)      # visual-gate: housing in hull slot (ribs, transoms, shoes stay dark)
    for x in (0, -7, 7): t.bbox('dark', 2.4, 22, 2.6, x, 13, -19.9, **RIBK)
    for s in SG: t.bbox('dark', 2.4, 22, 2.6, s * 13.7, 13, -19.9, rz=s * .11)
    for x in (-12.5, -7, 7, 12.5): pyr(t, 'trim', 2.8, 4, x, 24, -19.9)
    for x in (-14.9, -7, 0, 7, 14.9): t.box('trim', 3, 1.2, 3.2, x, 2.6, -19.9)
    for s in SG:
        t.box('glow_hot', 4.2, 11, .5, s * 3.5, 13, -19.6)
        t.box('glow_hot', 3.4, 9, .5, s * 10.3, 12.5, -19.6)
        t.box('dark', 4.8, .9, 1.0, s * 3.5, 13, -19.9)
        t.box('dark', 4.2, .9, 1.0, s * 10.3, 12.5, -19.9)
    t.box('bone', 5, 5, .6, 0, 13, -21.3, rz=Q)
    # ============================================ cathedral (stands on the deck top, y 29.5)
    for s in SG:
        t.bbox('dark', 5, 17.5, 5, s * 9.5, 38.25, 4.5, bev=.2, tx=.9, tz=.9)
        t.box('trim', 5.4, .8, 5.4, s * 9.5, 40, 4.5)
        t.box('dark', 5.2, 1, 5.2, s * 9.5, 47.5, 4.5)
        bpyr(t, 'trim', 4.8, 9.5, s * 9.5, 48, 4.5)
        lancet(t, 'glow', 1.5, 4.8, s * 9.5, 41.5, 6.85, '+z')
        lancet(t, 'glow', 1.5, 4.8, s * 11.85, 41.5, 4.5, '+x' if s > 0 else '-x')
    # nave
    t.bbox('dark', 14, 10.5, 10, 0, 34.75, .5)
    t.bbox('hull', 15, 6, 10.6, 0, 43, .5, tx=.02)
    t.box('trim', .8, .8, 10.8, 0, 46, .5)
    t.box('trim', .8, 3, .8, 0, 47.4, 5.5)
    t.box('trim', 1.6, 1.6, .5, 0, 47.8, 5.5, rz=Q)      # visual-gate: diamond, not a cross bar
    lancet(t, 'glow', 2.4, 8, 0, 31.5, 5.5, '+z')
    for s in SG:
        lancet(t, 'glow', 1.8, 6, s * 3.2, 31.5, 5.5, '+z')
        t.box('dark', 2.5, 4, 6.5, s * 8.25, 31.5, -1.25)
        t.box('hull', 3, .6, 6.7, s * 8.3, 34.2, -1.25, rz=-s * .45)
        for z in (-3.2, -1.2, .8): lancet(t, 'glow', 1.4, 4.2, s * 7, 35.2, z, '+x' if s > 0 else '-x')
    # transepts
    for s in SG:
        t.bbox('dark', 3.5, 9.5, 8, s * 7.25, 34.25, -8.5)
        t.box('hull', 3.9, 4.5, 8.6, s * 7.3, 41.25, -8.5, tz=.02)
        lancet(t, 'glow', 2.4, 7, s * 9, 31.5, -8.5, '+x' if s > 0 else '-x')
    # crossing tower and great spire
    t.bbox('dark', 11, 15, 10, 0, 37, -9, bev=.25, tx=.94, tz=.94)
    t.box('trim', 11, .9, 10, 0, 44.5, -9)
    t.bbox('hull', 10, 10, 9, 0, 49.5, -9, bev=.2)
    t.box('dark', 10.8, 1.2, 9.8, 0, 55.1, -9)
    for s in SG:
        lancet(t, 'glow', 1.6, 7, s * 2.2, 46, -4.5, '+z')
        lancet(t, 'glow', 1.6, 7, s * 2.2, 46, -13.5, '-z')
        for z in (-11.2, -6.8): lancet(t, 'glow', 1.6, 7, s * 5, 46, z, '+x' if s > 0 else '-x')
    for s in SG:
        for z in (-5.1, -12.9):
            t.bbox('dark', 1.8, 3.5, 1.8, s * 4.4, 57.45, z); bpyr(t, 'trim', 2.2, 5, s * 4.4, 59.2, z)
    t.bcyl('trim', 0.05, 4.0, 13.3, 0, 62.35, -9, seg=8, caps=False)
    t.bbox('dark', .7, 7, .7, 0, 71.5, -9)
    t.box('trim', 1.6, 1.6, .5, 0, 72.5, -9, rz=Q)      # visual-gate: diamond, not a cross yard
    # flying buttresses
    for s in SG:
        for z in (-6.5, -11.5):
            t.bbox('dark', 2.4, 11.5, 2.4, s * 11.5, 35.25, z, tx=.85, tz=.85)
            pyr(t, 'trim', 2.8, 5, s * 11.5, 41, z)
            t.box('dark', 7.8, .9, .9, s * 7.8, 43.5, z, rz=-s * .876)
    # stacks
    for s in SG:
        t.bcyl('soot', 2.4, 2.8, 15.5, s * 16.5, 37.25, -11.5, seg=8)
        t.cyl('trim', 3.0, 3.0, 1.2, s * 16.5, 43, -11.5, seg=8)
        t.cyl('soot', 1.8, 2.0, 10.5, s * 20, 34.75, -12.6, seg=6)
    return t

def c_head():
    h = Part('head')
    h.bbox('dark', 8, 7, 8, 0, 0, 3.5, bev=.3, tz=.9, fz=.8)
    h.box('hull', 8.6, 1.6, 5, 0, 3, 5.6, rx=.3)
    h.bbox('hull', 10, 3.5, 8, 0, -5.2, 3.5, bev=.3, fz=.85)
    h.box('glow', 6, 1.1, .5, 0, 1.2, 7.6)
    h.box('trim', 6.4, 3, 1, 0, -1.8, 7.8)
    for x in (-2.4, -.8, .8, 2.4): h.box('bone', .7, 3.4, .5, x, -1.8, 8.4)
    for s in SG:
        h.cyl('trim', .9, .9, 2, s * 4.3, .5, 5, rx=HP, seg=6)
        h.box('glow', 1.2, 1.2, .4, s * 4.3, .5, 6.1)
    return h

def c_arm_l():
    a = Part('arm_L')
    a.bcyl('dark', 6.5, 6.5, 7, -6.5, 0, 0, rz=HP, seg=10)
    a.bbox('hull', 12, 12, 22, 0, -4, 3, bev=.5, tx=.9, fz=.85)
    a.box('hull2', 11, 1.2, 12, 0, 2.4, 3)
    a.bbox('dark', 8, 10, 9, 0, -5, -10, bev=.3, tz=.85)
    for y_, z_ in ((-8, -14.4), (-5, -14.2), (-2, -14.0)): a.box('trim', 6.4, .8, .8, 0, y_, z_)   # visual-gate: rear louvres
    a.bbox('dark', 10.5, 10.5, 3, 0, -4, 15.5, bev=.3, tx=.92)   # self-review fix: 0.08 taper (rule 1 / Q2)
    a.bcyl('dark', 4, 4, 9, 0, -11.5, 1, rz=HP, seg=8)
    a.cyl('trim', 4.3, 4.3, 1, 0, -11.5, 1, rz=HP, seg=8)
    a.bbox('hull', 1.2, 14, 12, 6.7, -4, 3, rz=.08, bev=.3, tz=1.5)
    a.box('bone', .6, 7, 7, 7.5, -3, 3, rx=Q)
    a.box('tank', .5, 3.5, 3.5, 7.9, -3, 3, rx=Q)
    return a

def c_barrels():
    b = Part('barrels_L')
    for k in range(6):
        an = math.radians(60 * k)
        b.bcyl('soot', 1.3, 1.3, 27, 3.4 * math.cos(an), 3.4 * math.sin(an), 31, rx=HP, seg=6)
    b.cyl('dark', 1.6, 1.6, 26, 0, 0, 31, rx=HP, seg=6)
    for z in (24, 33, 41): b.bcyl('dark', 5.2, 5.2, 1.6, 0, 0, z, rx=HP, seg=10)
    return b

def c_arm_r():
    r = Part('arm_R')
    r.bcyl('dark', 6.5, 6.5, 7, 6.5, 0, 0, rz=HP, seg=10)
    r.bbox('hull', 12, 13, 24, 0, -4, 3, bev=.5, tx=.9, fz=.8)
    r.box('hull2', 11, 1.2, 12, 0, 3, 3)
    r.bbox('dark', 8, 10, 9, 0, -5, -10, bev=.3, tz=.85)
    for y_, z_ in ((-8, -14.4), (-5, -14.2), (-2, -14.0)): r.box('trim', 6.4, .8, .8, 0, y_, z_)   # visual-gate: rear louvres
    for x in (-3.5, 0, 3.5): r.cyl('tank', 1.5, 1.5, 7, x, -11.6, -2, rx=HP, seg=6)
    r.bcyl('dark', 2.8, 3.6, 32, 0, -4, 30, rx=HP, seg=8)
    for z in (19, 25.5, 32, 38.5): r.bbox('trim', 6.2, 6.2, 1.2, 0, -4, z, rz=Q)
    r.bbox('dark', 6.5, 6.5, 5, 0, -4, 45.5, bev=.3)
    r.box('trim', 1.2, 1.2, 5, 0, .2, 47)
    for s in SG: r.box('trim', 1.2, 1.2, 5, s * 3.6, -6.1, 47)
    r.bbox('hull', 1.2, 14, 12, -6.7, -4, 3, rz=-.08, bev=.3, tz=1.5)
    r.box('bone', .6, 7, 7, -7.5, -3, 3, rx=Q)
    r.box('tank', .5, 3.5, 3.5, -7.9, -3, 3, rx=Q)
    return r

def c_glow():
    g = Part('lance_glow')
    for z in (22.25, 28.75, 35.25): g.box('glow_charge', 4.4, 4.4, 3.6, 0, -4, z, rz=Q)
    g.box('glow_charge', 3, 3, .5, 0, -4, 48.2)
    return g

def c_thigh():
    th = Part('thigh')
    th.bbox('dark', 9.5, 10, 25, 0, 0, 12.5, bev=.4, fz=.85)
    th.bbox('hull', 12, 3.5, 19, 0, 6, 11, bev=.35, tx=.9, fz=.8)
    th.box('bone', 6, .8, 11, 0, 8, 10.5, fz=.8)
    th.box('tank', 3.6, .6, 3.6, 0, 8.5, 10.5, ry=Q)
    for s in SG:
        for z in (5, 12): th.box('trim', 1.2, 8, 2.6, s * 5.0, .5, z)
        th.cyl('trim', 1.5, 1.5, 20, s * 2.8, -5.6, 12, rx=HP, seg=6)
    th.bcyl('dark', 6.8, 6.8, 13, 0, 0, 25, rz=HP, seg=10)
    for s in SG: th.cyl('trim', 3, 3, .8, s * 6.7, 0, 25, rz=HP, seg=6)
    return th

def c_shin():
    sh = Part('shin')
    sh.bbox('dark', 8.5, 9, 27, 0, 0, 13.5, bev=.4, fz=1.15)
    sh.bbox('hull', 11.5, 3, 20, 0, 5.4, 14, bev=.3, fz=1.1)
    for s in SG: sh.bbox('hull', 1.2, 7, 16, s * 5.9, 1.5, 15, tz=.85)
    sh.box('bone', 3, .5, 6, 0, 7.1, 20.5)
    sh.bbox('hull2', 12.5, 5.5, 8.5, 0, 6.25, 4, bev=.35, tx=.8, tz=.8)
    bpyr(sh, 'trim', 4, 6, 0, 9, 4)
    for s in SG: sh.cyl('trim', 1.3, 1.3, 20, s * 2.6, -5, 14, rx=HP, seg=6)
    sh.bbox('dark', 5, 4, 11, 0, -5.5, 20, bev=.3, fz=1.2)
    sh.bcyl('dark', 5, 5, 11.5, 0, 0, 27, rz=HP, seg=10)
    return sh

def c_foot():
    f = Part('foot')
    f.bbox('dark', 15, 3, 21, 0, 1.5, 2, bev=.3, tx=.94, tz=.96)
    f.bbox('hull', 13, 2.6, 18, 0, 4.3, 1.5, bev=.3, tx=.85, tz=.85)
    f.box('trim', 15.6, .9, 21.6, 0, 2.9, 2)
    f.bbox('hull', 10.5, 4.4, 11, 0, 7.6, 0, bev=.35, tx=.8, tz=.75)
    for x in (-5.3, 0, 5.3):
        f.bbox('hull', 4.4, 3.6, 8, x, 1.8, 15.5, bev=.25, fz=.75)
        f.box('trim', 4.2, 1.0, 3, x, 3.9, 17.5, fz=.8)
    f.bbox('hull', 7, 3.6, 7, 0, 1.8, -11, bev=.25, tx=.85)
    f.box('trim', 6.4, 1.0, 2.6, 0, 3.9, -12.6)
    for s in SG: f.box('dark', 1.4, 6, 8, s * 6.1, 6.5, 0, tz=.7)
    return f

# furnace housing and centre-rib parameters (blockout fixes recorded in the Model notes; defaults = spec section 6.2)
FH, FY = 15.5, 11.75   # blockout fix: housing top lowered from y 21 to 19.5 (spec 4.4 spine column starts at y 19.55)
RIBK = {'tx': .92}      # self-review fix: the three upright cage ribs carry a 0.08 taper (rule 1 / Q2)

# ------------------------------------------------------------------ assemble
HH = 45.0; H_THIGH, H_SHIN, H_FOOT = 25.0, 27.0, 5.0; H_HIPX, H_FOOTX = 11.48, 14.0

def build_colossus(blockout=False):
    global BLK
    BLK = blockout; BOXLOG.clear(); LANCETS.clear()
    ensure_materials()
    coll = bpy.data.collections.get('Colossus')
    if not coll:
        coll = bpy.data.collections.new('Colossus'); bpy.context.scene.collection.children.link(coll)
    for o in list(coll.objects):
        m = o.data; bpy.data.objects.remove(o, do_unlink=True)
        if m and isinstance(m, bpy.types.Mesh) and m.users == 0: bpy.data.meshes.remove(m)
    P = {'colossus': empty('colossus', coll, 6.0)}
    spec = [('pelvis', c_pelvis, 'colossus', (0, 45, 0)), ('torso', c_torso, 'pelvis', (0, 50, 0)), ('head', c_head, 'torso', (0, 70, 13)),
            ('arm_L', c_arm_l, 'torso', (28, 62, 3)), ('barrels_L', c_barrels, 'arm_L', (28, 58, 3)),
            ('arm_R', c_arm_r, 'torso', (-28, 62, 3)), ('lance_glow', c_glow, 'arm_R', (-28, 62, 3))]
    for name, fn, par, org in spec:
        ob = fn().build(coll); place(ob, org); P[name] = ob
    for name, par, org in (('anchor_gatling', 'arm_L', (28, 58, 49)), ('anchor_lance', 'arm_R', (-28, 58, 53)), ('anchor_battery', 'torso', (27.5, 83, 18)),
                           ('anchor_head', 'head', (0, 73, 21)), ('anchor_reactor', 'torso', (0, 62, -20)), ('anchor_shield', 'torso', (0, 68, 0)),
                           ('anchor_stack_L', 'torso', (16.5, 95.5, -11.5)), ('anchor_stack_R', 'torso', (-16.5, 95.5, -11.5))):
        e = empty(name, coll, 1.5); e.matrix_world = Matrix.Translation(g2b(org)); P[name] = e; spec.append((name, None, par, None))
    segs = {n: fn().build(coll) for n, fn in (('thigh', c_thigh), ('shin', c_shin), ('foot', c_foot))}
    fwd = Vector((0, 0, 1)); knees = {}
    for side, tag in ((1, 'L'), (-1, 'R')):
        hip = Vector((side * H_HIPX, HH, 0)); fpos = Vector((side * H_FOOTX, 0, 0)); ank = fpos + Vector((0, H_FOOT, 0))
        d = ank - hip; L = d.length; d.normalize()
        a = math.acos(max(-1, min(1, (H_THIGH ** 2 + L * L - H_SHIN ** 2) / (2 * H_THIGH * L))))
        bend = fwd - d * fwd.dot(d); bend.normalize()
        knee = hip + d * math.cos(a) * H_THIGH + bend * math.sin(a) * H_THIGH; knees[tag] = tuple(round(c, 3) for c in knee)
        for n, frm, to in (('thigh', hip, knee), ('shin', knee, ank)):
            if side == 1: ob = segs[n]; ob.name = n + '_L'
            else: ob = bpy.data.objects.new(n + '_R', segs[n].data); coll.objects.link(ob)
            place(ob, frm, look_basis(frm, to)); P[ob.name] = ob; spec.append((ob.name, None, 'colossus', None))
        if side == 1: ob = segs['foot']; ob.name = 'foot_L'
        else: ob = bpy.data.objects.new('foot_R', segs['foot'].data); coll.objects.link(ob)
        place(ob, fpos); P[ob.name] = ob; spec.append((ob.name, None, 'colossus', None))
    bpy.context.view_layer.update()
    for name, fn, par, org in spec:
        ob = P[name]; mw = ob.matrix_world.copy(); ob.parent = P[par]; ob.matrix_parent_inverse = Matrix.Identity(4); ob.matrix_world = mw
    bpy.context.view_layer.update()
    build_proxies(P)
    per = {o.name: sum(len(p.vertices) - 2 for p in o.data.polygons) for o in coll.objects if o.type == 'MESH'}
    uniq = {o.data.name: sum(len(p.vertices) - 2 for p in o.data.polygons) for o in coll.objects if o.type == 'MESH'}
    return {'tris_engine_both_legs': sum(per.values()), 'tris_unique': sum(uniq.values()), 'per': per, 'knees': knees}

# ------------------------------------------------------------------ MountProxy (never exported)
def _mesh_obj(name, bm, coll):
    me = bpy.data.meshes.new(name); bm.to_mesh(me); bm.free(); ob = bpy.data.objects.new(name, me); coll.objects.link(ob); return ob

def _dome(name, coll, centre, r, ymin, keep=None, planes=()):
    """sphere (game coords centre) cut at y > ymin; extra half-space cuts as (normal_game, point_game) keeping the +normal side."""
    bm = bmesh.new(); bmesh.ops.create_uvsphere(bm, u_segments=24, v_segments=14, radius=r)
    for v in bm.verts: v.co = g2b(Vector(centre) + Vector((v.co.x, v.co.z, -v.co.y)))   # sphere is symmetric: any frame
    cuts = [((0, 1, 0), (0, ymin, 0))] + list(planes)
    for n, pt in cuts:
        geom = list(bm.verts) + list(bm.edges) + list(bm.faces)
        bmesh.ops.bisect_plane(bm, geom=geom, plane_co=g2b(pt), plane_no=g2b(n), clear_inner=True)
    bord = [e for e in bm.edges if e.is_boundary]
    if bord: bmesh.ops.holes_fill(bm, edges=bord)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    return _mesh_obj(name, bm, coll)

def _boxm(name, coll, centre, size, M=None):
    bm = bmesh.new(); bmesh.ops.create_cube(bm, size=1.0)
    for v in bm.verts: v.co = Vector((v.co.x * size[0], v.co.z * size[2], v.co.y * size[1]))   # game axes (x,y,z) stored as (x,z,y) pre-g2b
    for v in bm.verts:
        g = Vector((v.co.x, v.co.z, v.co.y)); g = (M @ g if M else g) + Vector(centre); v.co = g2b(g)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    return _mesh_obj(name, bm, coll)

def _cylm(name, coll, centre, r, h, seg=24):
    bm = bmesh.new(); bmesh.ops.create_cone(bm, cap_ends=True, segments=seg, radius1=r, radius2=r, depth=h)
    for v in bm.verts: v.co = v.co + g2b(centre)
    return _mesh_obj(name, bm, coll)

PROXY = {}    # name -> dict(kind, params) for the analytic checks in test R3

def build_proxies(P):
    pc = bpy.data.collections.get('MountProxy')
    if not pc:
        pc = bpy.data.collections.new('MountProxy'); bpy.context.scene.collection.children.link(pc)
    for o in list(pc.objects):
        m = o.data; bpy.data.objects.remove(o, do_unlink=True)
        if m: bpy.data.meshes.remove(m)
    T = Vector((0, 50, 0)); PROXY.clear()
    # flak_1: ring cylinder above the pad, forward dome above y 33
    _cylm('flak_1_ring', pc, T + Vector((0, 27.05 + 3.2, 15)), 4.2, 6.4)
    _dome('flak_1_dome', pc, T + Vector((0, 30.9, 15)), 10.5, 83.02, planes=[((0, 0, 1), (0, 0, 15 - 1.8))])
    PROXY['flak_1_ring'] = ('cyl', (0, 27.05, 15), 4.2, 6.4); PROXY['flak_1_dome'] = ('dome', (0, 80.9, 15), 10.5, 83.02, 'fwd')
    for s, nm in ((1, 'flak_2'), (-1, 'flak_3')):
        c = (s * 17, 29.5 + 0.05, 7)
        _cylm(nm + '_ring', pc, T + Vector((c[0], c[1] + 3.2, c[2])), 4.3, 6.4)
        _dome(nm + '_dome_out', pc, T + Vector((s * 17, 30.9, 7)), 10.5, 83.02, planes=[((s, 0, 0), (s * 17, 0, 0))])
        _dome(nm + '_dome_rear', pc, T + Vector((s * 17, 30.9, 7)), 10.5, 83.02, planes=[((-s, 0, 0), (s * 17, 0, 0)), ((0, 0, -1), (0, 0, 7))])
        PROXY[nm + '_ring'] = ('cyl', (c[0], 50 + c[1], c[2]), 4.3, 6.4)
        PROXY[nm + '_dome'] = ('dome', (s * 17, 80.9, 7), 10.5, 83.02, 'sec%d' % s)
    for s, nm in ((1, 'turret_L'), (-1, 'turret_R')):
        _cylm(nm + '_barbette', pc, T + Vector((s * 28.5, 35 + 2, -2)), 3.2, 4)
        _boxm(nm + '_house', pc, T + Vector((s * 28.5, 40.6, -2.4)), (5.6, 3.2, 6.4))
        _dome(nm + '_dome', pc, T + Vector((s * 28.5, 40.8, -2)), 9.5, 87.02)
        PROXY[nm + '_dome'] = ('dome', (s * 28.5, 90.8, -2), 9.5, 87.02, 'all')
    _boxm('spine_column', pc, T + Vector((0, 30.3, -17)), (11, 21.5, 6))
    PROXY['spine_column'] = ('box', (0, 80.3, -17), (11, 21.5, 6))
    P['_pc'] = pc
    for s, nm in ((1, 'L'), (-1, 'R')):
        sh = bpy.data.objects.get('shin_' + nm)
        if not sh: continue
        Rg = C3.transposed() @ sh.matrix_world.to_3x3() @ C3       # shin local axes in game frame
        org = Vector((sh.matrix_world.translation.x, sh.matrix_world.translation.z, -sh.matrix_world.translation.y))
        _boxm('kneebat_%s_pad' % nm, pc, org + Rg @ Vector((0, 8.9, 13)), (3.6, 4, 3), Rg)
        _boxm('kneebat_%s_keepclear' % nm, pc, org + Rg @ Vector((0, 10.75, 13)), (14, 4.5, 8), Rg)
        PROXY['kneebat_%s_keepclear' % nm] = ('obox', org, Rg, (14, 4.5, 8), (0, 10.75, 13))
    for o in pc.objects:
        o.display_type = 'WIRE'; o.hide_render = True

# ------------------------------------------------------------------ stage / render / bake / export
COLL = 'Colossus'
def _lin(c): return tuple(((v / 12.92) if v <= 0.04045 else ((v + 0.055) / 1.055) ** 2.4) for v in c)

def make_stage():
    sc = bpy.context.scene
    st = bpy.data.collections.get('Stage')
    if st: return
    st = bpy.data.collections.new('Stage'); sc.collection.children.link(st)
    cam = bpy.data.objects.new('CC_Cam', bpy.data.cameras.new('CC_Cam')); st.objects.link(cam); sc.camera = cam; cam.data.lens = 60; cam.data.clip_end = 3000
    for nm, e, rot, col in (('Key', 4.0, (0.9, 0.1, -0.7), (1, .93, .85)), ('Fill', 1.2, (1.1, 0, 2.2), (.6, .7, 1)), ('Rim', 0.35, (1.3, 0, 3.6), (1, .6, .35))):
        l = bpy.data.objects.new('CC_' + nm, bpy.data.lights.new('CC_' + nm, 'SUN')); l.data.energy = e; l.data.color = col; l.rotation_euler = rot; st.objects.link(l)
    me = bpy.data.meshes.new('CC_Ground'); me.from_pydata([(-900, -900, 0), (900, -900, 0), (900, 900, 0), (-900, 900, 0)], [], [(0, 1, 2, 3)])
    g = bpy.data.objects.new('CC_Ground', me); st.objects.link(g)
    gm = bpy.data.materials.new('cc_ground'); gm.use_nodes = True; gm.node_tree.nodes['Principled BSDF'].inputs['Base Color'].default_value = (.22, .2, .19, 1); me.materials.append(gm)
    w = bpy.data.worlds.new('CC_World'); sc.world = w; w.use_nodes = True
    w.node_tree.nodes['Background'].inputs[0].default_value = (.32, .34, .38, 1); w.node_tree.nodes['Background'].inputs[1].default_value = 0.7
    sc.render.engine = 'CYCLES'; sc.cycles.device = 'CPU'; sc.cycles.use_denoising = True
    sc.render.resolution_x = 1400; sc.render.resolution_y = 1000; sc.view_settings.view_transform = 'Standard'

GLOW_STR = {'glow': 4.4, 'glow_hot': 4.4, 'glow_charge': 5.2}
def set_glow(glow=False, hot=False, charge=False):
    for n, on in (('glow', glow), ('glow_hot', hot), ('glow_charge', charge)):
        b = bpy.data.materials[n].node_tree.nodes['Principled BSDF']
        b.inputs['Emission Strength'].default_value = GLOW_STR[n] if on else 0.0
        b.inputs['Base Color'].default_value = (0, 0, 0, 1) if not on else (0, 0, 0, 1)

def set_blk(on):
    bpy.context.view_layer.material_override = bpy.data.materials['blk'] if on else None

def set_sil(on):
    sc = bpy.context.scene; vl = bpy.context.view_layer
    if on:
        m = bpy.data.materials.get('cc_sil') or bpy.data.materials.new('cc_sil'); m.use_nodes = True; nt = m.node_tree; nt.nodes.clear()
        o = nt.nodes.new('ShaderNodeOutputMaterial'); e = nt.nodes.new('ShaderNodeEmission'); e.inputs['Color'].default_value = (0, 0, 0, 1); e.inputs['Strength'].default_value = 0
        nt.links.new(e.outputs[0], o.inputs[0]); vl.material_override = m
        sc.world.node_tree.nodes['Background'].inputs[0].default_value = (1, 1, 1, 1); sc.world.node_tree.nodes['Background'].inputs[1].default_value = 1.0
        bpy.data.objects['CC_Ground'].hide_render = True; sc.cycles.use_denoising = False
    else:
        vl.material_override = None
        sc.world.node_tree.nodes['Background'].inputs[0].default_value = (.32, .34, .38, 1); sc.world.node_tree.nodes['Background'].inputs[1].default_value = 0.7
        bpy.data.objects['CC_Ground'].hide_render = False; sc.cycles.use_denoising = True

def shot(path, az, el=0.12, dist=430, tgt=(0, 0, 60), samples=48, ortho=None, up=None):
    sc = bpy.context.scene; cam = bpy.data.objects['CC_Cam']; t = Vector(tgt)
    if ortho:
        cam.data.type = 'ORTHO'; cam.data.ortho_scale = ortho
    else: cam.data.type = 'PERSP'
    p = t + Vector((math.sin(az) * math.cos(el), -math.cos(az) * math.cos(el), math.sin(el))) * dist
    cam.location = p
    if up == 'top':
        cam.location = t + Vector((0, 0, dist)); cam.rotation_euler = (0, 0, 0)
    else: cam.rotation_euler = (t - p).to_track_quat('-Z', 'Y').to_euler()
    sc.cycles.samples = samples; sc.render.filepath = path; bpy.ops.render.render(write_still=True)

def engine_objs(): return [o for o in bpy.data.collections[COLL].objects if o.type == 'MESH']

def bake_ao(samples=48):
    sc = bpy.context.scene; coll = bpy.data.collections[COLL]
    sc.render.engine = 'CYCLES'; sc.cycles.device = 'CPU'; sc.cycles.samples = samples; sc.render.bake.target = 'VERTEX_COLORS'
    sc.world.light_settings.distance = 14.0
    bpy.data.collections['MountProxy'].hide_viewport = True; bpy.data.objects['CC_Ground'].hide_viewport = True
    bpy.context.view_layer.update()
    done = set()
    for o in coll.objects:
        if o.type != 'MESH' or o.data.name in done: continue
        done.add(o.data.name); me = o.data
        ao = me.color_attributes.new('AO', 'FLOAT_COLOR', 'CORNER'); me.color_attributes.active_color = ao
        bpy.ops.object.select_all(action='DESELECT'); o.select_set(True); bpy.context.view_layer.objects.active = o
        bpy.ops.object.bake(type='AO')
        col = me.color_attributes['Color']; ao = me.color_attributes['AO']
        for i in range(len(col.data)):
            v = col.data[i].color[0] * (0.55 + 0.45 * ao.data[i].color[0]); col.data[i].color = (v, v, v, 1)
        me.color_attributes.remove(me.color_attributes['AO'])
        me.color_attributes.active_color = me.color_attributes['Color']; me.color_attributes.render_color_index = 0
    bpy.data.collections['MountProxy'].hide_viewport = False; bpy.data.objects['CC_Ground'].hide_viewport = False

def export_glb(path):
    coll = bpy.data.collections[COLL]
    bpy.ops.object.select_all(action='DESELECT')
    for o in coll.objects: o.select_set(True)
    bpy.context.view_layer.objects.active = bpy.data.objects['colossus']
    bpy.ops.export_scene.gltf(filepath=path, export_format='GLB', use_selection=True, export_yup=True, export_apply=False, export_animations=False,
                              export_texcoords=False, export_normals=True, export_materials='EXPORT', export_vertex_color='ACTIVE')

# ------------------------------------------------------------------ measurable tests (spec section 12); world metres, game frame
def _gv(p): return Vector((p.x, p.z, -p.y))

def polys_world():
    out = []
    for o in engine_objs():
        mw = o.matrix_world; me = o.data
        for p in me.polygons:
            vs = [_gv(mw @ me.vertices[i].co) for i in p.vertices]
            nm = me.materials[p.material_index].name if me.materials[p.material_index] else '?'
            n = mw.to_3x3() @ p.normal; n = Vector((n.x, n.z, -n.y)).normalized()
            out.append((o.name, nm, vs, p.area, n))
    return out

def _inside(kind, prm, v):
    if kind == 'cyl':
        c, r, h = prm
        return Vector((v.x - c[0], v.z - c[2], 0)).length < r - 0.02 and c[1] + 0.02 < v.y < c[1] + h - 0.02
    if kind == 'box':
        c, s = prm
        return all(abs(v[i] - c[i]) < s[i] / 2 - 0.02 for i in range(3))
    if kind == 'obox':
        org, Rg, s, c = prm
        l = Rg.transposed() @ (v - org) - Vector(c)
        return all(abs(l[i]) < s[i] / 2 - 0.02 for i in range(3))
    return False

def _in_dome(c, r, ymin, v, mode):
    if not ((v - Vector(c)).length < r - 0.02 and v.y > ymin + 0.02): return False
    dx = v.x - c[0]; dz = v.z - c[2]
    if mode == 'all': return True
    if mode == 'fwd': return abs(math.degrees(math.atan2(dx, dz))) <= 100
    s = -1 if '-' in mode else 1                      # flak_2/3 yaw sector: protected 0..220 and 340..360 toward the outboard side
    th = math.degrees(math.atan2(dx * s, dz)) % 360
    return th <= 220 or th >= 340

def _battery(v): return 22.4 < abs(v.x) < 33.2 and 78.9 < v.y < 85.1 and -8.5 < v.z < 17.6

def _cast(origin_g, dir_g):
    sc = bpy.context.scene; dg = bpy.context.evaluated_depsgraph_get()
    o = Vector((origin_g[0], -origin_g[2], origin_g[1])); d = Vector((dir_g[0], -dir_g[2], dir_g[1]))
    hit, loc, nor, idx, ob, mt = sc.ray_cast(dg, o, d)
    if not hit: return None
    mats = ob.data.materials
    mat = mats[ob.data.polygons[idx].material_index].name if len(mats) else '?'
    return ob.name, mat, _gv(loc), ob

def smax(it, *a):
    if a: return max(it, *a)
    it = list(it); return max(it) if it else float('nan')
def smin(it, *a):
    if a: return min(it, *a)
    it = list(it); return min(it) if it else float('nan')

def _samples(vs, step=0.9):
    pts = list(vs)
    for k in range(1, len(vs) - 1):
        a, b, c = vs[0], vs[k], vs[k + 1]; n = max(1, int(max((b - a).length, (c - a).length, (c - b).length) / step))
        for i in range(n + 1):
            for j in range(n + 1 - i): pts.append(a + (b - a) * (i / n) + (c - a) * (j / n))
    return pts

def run_tests(blockout=False):
    if not PROXY: build_proxies({})
    bpy.data.collections['MountProxy'].hide_viewport = True; bpy.context.view_layer.update()
    R = {}; polys = polys_world(); allv = [(n, nm, v) for n, nm, vs, a, nn in polys for v in vs]
    pts = [(n, nm, v) for n, nm, vs, a, nn in polys for v in _samples(vs)]
    def sel(f): return [v for n, nm, v in allv if f(n, nm, v)]
    xs = [v.x for n, nm, v in allv]
    w = smax(xs) - smin(xs)
    R['F1_width'] = (round(w, 2), 70 <= w <= 73.5)
    mast = smax(v.y for v in sel(lambda n, nm, v: abs(v.x) < .5 and v.y > 115))
    sp = sel(lambda n, nm, v: abs(v.x) < .5 and abs(v.z + 9) < 0.5 and 118.5 < v.y < 119.5)
    spire = smax(v.y for v in sp) if sp else 0
    R['F2_spire_mast'] = ((round(spire, 2), round(mast, 2)), 118 <= spire <= 120 and 124 <= mast <= 126)
    lv = [('mast', mast), ('spire', spire),
          ('crossing_pinnacles', smax(v.y for v in sel(lambda n, nm, v: 3.3 < abs(v.x) < 5.5 and abs(v.z + 9) > 3 and 100 < v.y < 120))),
          ('west_spires', smax(v.y for v in sel(lambda n, nm, v: 7 < abs(v.x) < 12 and v.z > 1.5 and 90 < v.y < 115))),
          ('nave_ridge', smax(v.y for v in sel(lambda n, nm, v: abs(v.x) < .5 and 0 < v.z < 5.2 and 90 < v.y < 98))),
          ('great_stacks', smax(v.y for v in sel(lambda n, nm, v: 14 < abs(v.x) < 19 and v.z < -9 and v.y > 85))),
          ('pauldron_pinnacles', smax(v.y for v in sel(lambda n, nm, v: 31 < abs(v.x) < 36 and v.y > 83))),
          ('battery', smax(v.y for v in sel(lambda n, nm, v: 23 < abs(v.x) < 33 and 80 < v.y < 88 and -8 < v.z < 3))),
          ('deck', smax(v.y for v in sel(lambda n, nm, v: abs(v.x) < 22.6 and 78 < v.y < 80)))]
    levels = []; last = 1e9
    for n, y in sorted(lv, key=lambda t: -t[1]):
        if last - y >= 4 - 1e-6: levels.append(n); last = y
    R['F3_levels'] = (({n: round(y, 1) for n, y in lv}, levels), len(levels) >= 7)
    R['F4_waist_ratio'] = (round(21.0 / w, 3), 21.0 / w <= 0.33)
    thx = [v.x for n, nm, v in allv if n == 'thigh_L' and nm == 'hull']; thw = smax(thx) - smin(thx)
    sh = bpy.data.objects['shin_L']
    shl = [sh.matrix_world.inverted() @ Vector((v.x, -v.z, v.y)) for n, nm, v in allv if n == 'shin_L' and nm == 'hull']
    shg = [Vector((q.x, q.z, -q.y)) for q in shl]
    greave = [q for q in shg if 4.5 < q.y < 7.5 and 4 < q.z < 24]
    gw = smax(q.x for q in greave) - smin(q.x for q in greave) if greave else 0
    R['F5_leg_width'] = ({'cuisse_hull': round(thw, 2), 'greave': round(gw, 2)}, thw >= 11.5 and gw >= 11.5)
    kx = [v.x for n, nm, v in allv if n == 'shin_L' and nm == 'hull2']; kxr = [v.x for n, nm, v in allv if n == 'shin_R' and nm == 'hull2']
    gap = (smin(kx) - smax(kxr)) if kx and kxr else 0
    R['F6_knee_gap'] = (round(gap, 2), 10 <= gap <= 14)
    vis = []; hid = []
    for (nd, tag, x, y, z, face, ww, hh) in LANCETS:
        if face != '+z': continue
        wp = _gv(bpy.data.objects[nd].matrix_world.translation)
        gx, gy, gz = wp.x + x, wp.y + y, wp.z + z
        ok = 0
        for dx, dy in ((0, 0), (ww * .3, hh * .15), (-ww * .3, hh * .15), (0, -hh * .3), (0, hh * .3)):
            r = _cast((gx + dx, gy + dy, gz + 300), (0, 0, -1))
            if r and r[1] == 'glow' and abs(r[2].z - gz) < .4: ok += 1
        (vis if ok >= 4 else hid).append((round(gx, 1), round(gy, 1), round(gz, 1), ok))
    R['F7_lancets_front'] = ({'visible': len(vis), 'hidden': hid}, len(vis) == 13 and not hid)
    vz = [v for n, nm, v in allv if n == 'head' and nm == 'glow' and abs(v.x) < 3.2]
    vy = (smax(v.y for v in vz) + smin(v.y for v in vz)) / 2 if vz else 0
    R['F8_visor_y'] = (round(vy, 2), 70.5 <= vy <= 72)
    hz = smax(v.z for n, nm, v in allv if n == 'head')
    lip = smax(v.z for n, nm, v in allv if n == 'torso' and nm == 'trim' and 75.8 < v.y < 77.2 and abs(v.x) < 12 and v.z > 18)
    R['S1_head_front'] = ({'head_z': round(hz, 2), 'lip_z': round(lip, 2), 'ahead': round(hz - lip, 2)}, 20 <= hz <= 22.5 and hz - lip >= 0.8)
    kneez = -sh.matrix_world.translation.y
    legz = smax(v.z for n, nm, v in allv if n in ('thigh_L', 'shin_L') and v.y > 5.5)
    tipw = _gv(sh.matrix_world @ Vector((0, -4, 15)))     # shin local game (0, 15, 4) -> blender (0, -4, 15)
    R['S2_knee'] = ({'knee_z': round(kneez, 2), 'spirelet_tip_z': round(tipw.z, 2), 'leg_max_z_above_foot': round(legz, 2)}, 15.5 <= kneez <= 17.5 and abs(legz - tipw.z) < 0.3)
    def rake(o, f, ybot, ytop):      # z of the largest front-facing hull face, extrapolated to its box edges (sees through bevels)
        cand = [(a, vs) for n, nm, vs, a, nn in polys if n == o and nm == 'hull' and nn.z > 0.9 and f(sum(vs, Vector()) / len(vs))]
        a, vs = max(cand, key=lambda t: t[0]); lo = [v for v in vs if v.y < sum(q.y for q in vs) / len(vs)]; hi = [v for v in vs if v.y >= sum(q.y for q in vs) / len(vs)]
        zl = sum(v.z for v in lo) / len(lo); yl = sum(v.y for v in lo) / len(lo); zh = sum(v.z for v in hi) / len(hi); yh = sum(v.y for v in hi) / len(hi)
        k = (zh - zl) / (yh - yl); return zl + k * (ybot - yl), zh + k * (ytop - yh)
    zb, zt = rake('torso', lambda c: abs(c.x) < 8 and 55 < c.y < 74 and c.z < 12.5, 53.0, 75.0)
    s3 = zt - zb
    R['S3_hull_rake'] = (round(s3, 2), s3 >= 2.5)
    pzb, pzt = rake('torso', lambda c: 20 < c.x < 36 and 65 < c.y < 77 and 13 < c.z < 15, 64.5, 77.5)
    pr_ = [(v.z, v.y) for n, nm, vs, a, nn in polys if n == 'torso' and nm == 'hull' and nn.z < -0.5 and 20 < sum(q.x for q in vs) / len(vs) < 36 and 64 < sum(q.y for q in vs) / len(vs) < 78 and sum(q.z for q in vs) / len(vs) < -8 for v in vs]
    hb = [v.z for n, nm, v in allv if n == 'torso' and nm == 'hull' and abs(v.x) < 5 and 53 <= v.y <= 53.6]
    ht = [v.z for n, nm, v in allv if n == 'torso' and nm == 'hull' and abs(v.x) < 5 and 74.4 <= v.y <= 75.1]
    pb = [v.z for n, nm, v in allv if n == 'torso' and nm == 'hull' and 20 < v.x < 36 and 64.4 <= v.y <= 65.3]
    pt = [v.z for n, nm, v in allv if n == 'torso' and nm == 'hull' and 20 < v.x < 36 and 76.7 <= v.y <= 77.6]
    s4f = pzt - pzb
    rl = [(a, vs) for n, nm, vs, a, nn in polys if n == 'torso' and nm == 'hull' and nn.z < -0.5 and 20 < (sum(q.x for q in vs) / len(vs)) < 36 and 65 < (sum(q.y for q in vs) / len(vs)) < 77]
    a_, vs_ = max(rl, key=lambda t: t[0]); my = sum(q.y for q in vs_) / len(vs_)
    lo_ = [v for v in vs_ if v.y < my]; hi_ = [v for v in vs_ if v.y >= my]
    zl_ = sum(v.z for v in lo_) / len(lo_); yl_ = sum(v.y for v in lo_) / len(lo_); zh_ = sum(v.z for v in hi_) / len(hi_); yh_ = sum(v.y for v in hi_) / len(hi_)
    kk = (zh_ - zl_) / (yh_ - yl_); s4r = (zh_ + kk * (77.5 - yh_)) - (zl_ + kk * (64.5 - yl_))
    R['S4_pauldron'] = ({'front': round(s4f, 2), 'rear': round(s4r, 2)}, s4f >= 1.2 and s4r >= 2.0)
    R['S5_spire'] = ({'axis_behind': 9.0, 'jaw_to_spire': round(hz + 9.0, 2)}, hz + 9.0 >= 29)
    bz = [v.z for n, nm, v in allv if n in ('pelvis', 'torso', 'head') and v.y > 0 and v.y > 44]
    R['S6_depth'] = ({'rear': round(smin(bz), 2), 'front': round(smax(bz), 2)}, smin(bz) >= -22 and smax(bz) <= 22.5)
    gat = smax(v.z for n, nm, v in allv if n == 'barrels_L'); lan = smax(v.z for n, nm, v in allv if n == 'arm_R')
    R['S7_muzzles'] = ({'gatling': round(gat, 2), 'lance': round(lan, 2)}, 46.5 <= gat <= 48.5 and 51.5 <= lan <= 53.5)
    def thick(on, zr):
        o = bpy.data.objects[on]; mi = o.matrix_world.inverted()
        ls = [Vector((q.x, q.z, -q.y)) for q in (mi @ Vector((v.x, -v.z, v.y)) for n, nm, v in pts if n == on)]
        sub = [q for q in ls if zr[0] <= q.z <= zr[1]]
        return smax(q.y for q in sub) - smin(q.y for q in sub)
    th_t = thick('thigh_L', (8, 16)); sh_t = thick('shin_L', (12, 24))
    R['S8_thickness'] = ({'thigh': round(th_t, 2), 'shin': round(sh_t, 2)}, th_t >= 13 and sh_t >= 13)
    fz = [v.z for n, nm, v in allv if n == 'foot_L']
    R['S9_foot'] = ({'length': round(smax(fz) - smin(fz), 2), 'ankle_drum_w': 11.5, 'shin_core_w_at_knee': 8.5, 'ankle_wider': 11.5 > 8.5}, 33 <= smax(fz) - smin(fz) <= 35)
    area = 0.0; tot = 0.0; N = 40
    for (cx, cy, ww, hh) in ((3.5, 63, 4.2, 11), (-3.5, 63, 4.2, 11), (10.3, 62.5, 3.4, 9), (-10.3, 62.5, 3.4, 9)):
        hit = 0
        for i in range(N):
            for j in range(N):
                x = cx - ww / 2 + (i + .5) * ww / N; y = cy - hh / 2 + (j + .5) * hh / N
                r = _cast((x, y, -60), (0, 0, 1))
                if r and r[1] == 'glow_hot': hit += 1
        area += ww * hh * hit / (N * N); tot += ww * hh
    R['R1_hot_area'] = ({'visible_m2': round(area, 1), 'total_m2': round(tot, 1)}, area >= 130)
    col = [(n, nm, v) for n, nm, v in pts if abs(v.x) < 5.5 - .02 and 69.62 < v.y < 91 and -20 < v.z < -14.42 and not (abs(v.x) < 1.3 and v.y <= 74.02) and v.z < -15.05]
    R['R2_spine'] = ({'verts_inside': len(col), 'sample': [(n, nm, round(v.x, 1), round(v.y, 1), round(v.z, 1)) for n, nm, v in col[:6]]}, len(col) == 0)
    r3 = {}
    for nm, pr in PROXY.items():
        kind = pr[0]; cnt = 0; bat = 0
        for n, mt, v in pts:
            if kind == 'dome': ins = _in_dome(pr[1], pr[2], pr[3], v, pr[4])
            elif kind == 'cyl': ins = _inside('cyl', (pr[1], pr[2], pr[3]), v)
            elif kind == 'box':
                ins = _inside('box', (pr[1], pr[2]), v) and not (v.z > -15.05 or (abs(v.x) < 1.3 and v.y <= 74.02 and v.z < -18.5))
            else: ins = _inside('obox', pr[1:], v)
            if ins:
                if kind == 'dome' and nm.startswith('flak_') and _battery(v): bat += 1
                else: cnt += 1
        r3[nm] = (cnt, bat)
    R['R3_mounts'] = ({k: {'inside': c, 'battery_exempt': b} for k, (c, b) in r3.items()}, all(c == 0 for c, b in r3.values()))
    tx = smax(abs(v.x) for n, nm, v in allv if n == 'torso' and 79.5 < v.y < 90 and -12.6 < v.z < -4.4 and 5 < abs(v.x) < 9.6)
    tw = smin(v.z for n, nm, v in allv if n == 'torso' and nm == 'dark' and 79.5 < v.y < 85 and 5.5 < abs(v.x) < 12.1 and 2 < v.z < 7.5)
    R['R4_cross'] = ({'transept_tip_x': round(tx, 2), 'nave_half_w': 7.0, 'tower_z_min': round(tw, 2)}, tx >= 9 and tw > -4.5)
    fx = [v.x for n, nm, v in allv if n.startswith('foot')]
    R['R5_stance'] = (round(smax(fx) - smin(fx), 2), 42 <= smax(fx) - smin(fx) <= 45)
    best = (0, None)
    for n, nm, vs, a, nn in polys:
        if nm == 'trim' and a > 15:
            c = sum(vs, Vector()) / len(vs); p0 = c + nn * 0.03
            r = _cast((p0.x, p0.y, p0.z), (nn.x, nn.y, nn.z))
            if r is None and a > best[0]: best = (a, (n, tuple(round(k, 1) for k in c)))
    R['Q1_trim_flat'] = ((round(best[0], 1), best[1]), best[0] <= 40)
    bad = [b for b in BOXLOG if b[1] in ('hull', 'hull2', 'dark') and smax(b[2:5]) > 8 and not b[5] and (b[2], b[3], b[4]) not in EXEMPT and smin(b[2:5]) >= 1.7]
    R['Q2_untapered'] = (bad, not bad)
    big = {}
    for n, nm, vs, a, nn in polys:
        if a > 160: big['%s/%s' % (n, nm)] = smax(big.get('%s/%s' % (n, nm), 0), round(a))
    R['Q3_flat_over_160'] = (big, 'judged by section 8 detail + renders')
    used = set(nm for n, nm, vs, a, nn in polys)
    R['Q4_slots'] = (sorted(used), used <= set(MATNAMES))
    per = {o.name: sum(len(p.vertices) - 2 for p in o.data.polygons) for o in engine_objs()}
    uq = {o.data.name: sum(len(p.vertices) - 2 for p in o.data.polygons) for o in engine_objs()}
    R['Q5_tris'] = ({'both_legs': sum(per.values()), 'unique': sum(uq.values())}, 6300 <= sum(per.values()) <= 7300)
    spec = {'colossus': (None, (0, 0, 0)), 'pelvis': ('colossus', (0, 45, 0)), 'torso': ('pelvis', (0, 50, 0)), 'head': ('torso', (0, 70, 13)), 'arm_L': ('torso', (28, 62, 3)),
            'barrels_L': ('arm_L', (28, 58, 3)), 'arm_R': ('torso', (-28, 62, 3)), 'lance_glow': ('arm_R', (-28, 62, 3)),
            'thigh_L': ('colossus', (11.48, 45, 0)), 'thigh_R': ('colossus', (-11.48, 45, 0)), 'shin_L': ('colossus', (12.66, 26.30, 16.55)), 'shin_R': ('colossus', (-12.66, 26.30, 16.55)),
            'foot_L': ('colossus', (14, 0, 0)), 'foot_R': ('colossus', (-14, 0, 0)),
            'anchor_gatling': ('arm_L', (28, 58, 49)), 'anchor_lance': ('arm_R', (-28, 58, 53)), 'anchor_battery': ('torso', (27.5, 83, 18)), 'anchor_head': ('head', (0, 73, 21)),
            'anchor_reactor': ('torso', (0, 62, -20)), 'anchor_shield': ('torso', (0, 68, 0)), 'anchor_stack_L': ('torso', (16.5, 95.5, -11.5)), 'anchor_stack_R': ('torso', (-16.5, 95.5, -11.5))}
    errs = []; mx = 0
    for nm, (par, pos) in spec.items():
        o = bpy.data.objects.get(nm)
        if not o: errs.append('missing ' + nm); continue
        if (o.parent.name if o.parent else None) != par: errs.append('parent ' + nm)
        d = (_gv(o.matrix_world.translation) - Vector(pos)).length; mx = smax(mx, d)
        if d > 0.01: errs.append('pivot %s %.3f' % (nm, d))
    names = set(o.name for o in bpy.data.collections[COLL].objects)
    if names != set(spec): errs.append('node set differs: %s' % (names ^ set(spec)))
    R['Q6_nodes'] = ({'max_pivot_err': round(mx, 4), 'errs': errs}, not errs)
    sym = True
    for on in ('thigh_L', 'shin_L', 'foot_L'):
        pts = set((round(v.co.x, 3), round(v.co.y, 3), round(v.co.z, 3)) for v in bpy.data.objects[on].data.vertices)
        sym = sym and all((-p[0], p[1], p[2]) in pts for p in pts)
    shared = all(bpy.data.objects[a + '_R'].data is bpy.data.objects[a + '_L'].data for a in ('thigh', 'shin', 'foot'))
    R['Q7_symmetry'] = ({'symmetric': sym, 'shared_mesh': shared}, sym and shared)
    bpy.data.collections['MountProxy'].hide_viewport = False
    return R

def fmt(R):
    return {k: ('PASS' if v[1] is True else ('FAIL' if v[1] is False else v[1]), v[0]) for k, v in R.items()}
