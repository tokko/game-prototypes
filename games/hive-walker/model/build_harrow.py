# Harrow-class line engine: geometry source, built from model/harrow-visual.md (decision-complete spec).
# Executed inside the Blender MCP session: exec(open(path).read()). It pulls in build_scout.py's helpers (Part, empty, g2b,
# place, look_basis) if they are not already defined. GAME coordinates throughout: x = walker's left, y = up, z = forward, metres.
# Every Builder call below is a literal transcription of the spec's part lists; BEVK scales the chamfer added on top (0 = pure
# blockout, 1 = Kestrel/Hierarch-style chamfered armour).
import bpy, bmesh, math, os
from mathutils import Vector, Matrix, Euler

_HERE = r'L:\Work\ai_projects\hive-walker-web\model'
if 'Part' not in globals():
    exec(open(os.path.join(_HERE, 'build_scout.py')).read())
MATNAMES[:] = ['hull', 'hull2', 'dark', 'trim', 'bone', 'soot', 'tank', 'glow', 'glow_hot', 'glow_charge']
hp, q = math.pi / 2, math.pi / 4
SQ = math.sqrt(2)
BEVK = globals().get('BEVK', 1.0)
COLL = 'Harrow'

def ensure_materials():
    MATS = {'hull': ((0.275, 0.322, 0.369), 0.62, 0.35), 'hull2': ((0.604, 0.580, 0.494), 0.7, 0.1), 'dark': ((0.114, 0.133, 0.157), 0.6, 0.5),
            'trim': ((0.604, 0.478, 0.227), 0.45, 0.8), 'bone': ((0.604, 0.580, 0.494), 0.8, 0.0), 'soot': ((0.043, 0.039, 0.035), 0.85, 0.2),
            'tank': ((0.478, 0.165, 0.110), 0.55, 0.3), 'glow': ((2.2, 1.3, 0.35), 0.5, 0.0), 'glow_hot': ((2.2, 0.3, 0.1), 0.5, 0.0),
            'glow_charge': ((1.0, 1.0, 1.0), 0.5, 0.0)}
    lin = lambda c: tuple(((v / 12.92) if v <= 0.04045 else ((v + 0.055) / 1.055) ** 2.4) for v in c)
    for n, (c, r, m) in MATS.items():
        mt = bpy.data.materials.get(n) or bpy.data.materials.new(n); mt.use_nodes = True; nt = mt.node_tree; nt.nodes.clear()
        out = nt.nodes.new('ShaderNodeOutputMaterial'); b = nt.nodes.new('ShaderNodeBsdfPrincipled'); nt.links.new(b.outputs[0], out.inputs[0])
        if n.startswith('glow'):
            mx = max(c); b.inputs['Base Color'].default_value = (0, 0, 0, 1)
            b.inputs['Emission Color'].default_value = (c[0] / mx, c[1] / mx, c[2] / mx, 1); b.inputs['Emission Strength'].default_value = mx * (0.0 if n == 'glow_charge' else 2)
        else:
            col = nt.nodes.new('ShaderNodeVertexColor'); col.layer_name = 'Color'
            mix = nt.nodes.new('ShaderNodeMix'); mix.data_type = 'RGBA'; mix.blend_type = 'MULTIPLY'; mix.inputs[0].default_value = 1.0
            mix.inputs[6].default_value = (*lin(c), 1)
            nt.links.new(col.outputs['Color'], mix.inputs[7]); nt.links.new(mix.outputs[2], b.inputs['Base Color'])
            b.inputs['Roughness'].default_value = r; b.inputs['Metallic'].default_value = m

# ---- Builder-signature wrapper: box(w,h,d,x,y,z,color,rx,ry,rz), cyl(rTop,rBottom,h,x,y,z,color,rx,ry,rz,seg=8), pyr(w,h,x,y,z,color,d)
class SB:
    def __init__(s, name): s.p = Part(name)
    def box(s, w, h, d, x, y, z, c, rx=0, ry=0, rz=0, bev=0.0, **kw):
        s.p.box(c, w, h, d, x, y, z, rx, ry, rz, bev=bev * BEVK, **kw); return s
    def cyl(s, rt, rb, h, x, y, z, c, rx=0, ry=0, rz=0, seg=8, **kw):
        s.p.cyl(c, rt, rb, h, x, y, z, rx, ry, rz, seg=seg, **kw); return s
    def pyr(s, w, h, x, y, z, c, d=None):               # base at y, apex at y + h, cannot be rotated
        if d is None: s.p.cyl(c, 0.02, w / SQ, h, x, y + h / 2, z, seg=4, caps='bottom')
        else: s.p.box(c, w, h, d, x, y + h / 2, z, tx=.03, tz=.03)
        return s

D, T, Bn, S, H, H2, Tk = 'dark', 'trim', 'bone', 'soot', 'hull', 'hull2', 'tank'
g, hot, W = 'glow', 'glow_hot', 'glow_charge'

def mk_pelvis(side=0):
    p = SB('pelvis')
    p.box(13, 5, 10, 0, 0, 0, D, bev=.3).cyl(3.2, 3.2, 4, 7, 0, 0, T, 0, 0, hp).cyl(3.2, 3.2, 4, -7, 0, 0, T, 0, 0, hp).box(7, 5, 8, 0, -3.5, 1, D, bev=.3)
    p.box(5, 9, 0.5, 0, -6.5, 5.4, Bn).box(1.2, 7, 0.4, 0, -6.5, 5.7, D).box(2.6, 2.6, 0.4, 0, -4.5, 5.8, T if side else H, 0, 0, q).box(9, 6, 0.6, 0, -4, -5.3, H)
    p.cyl(4.6, 5.2, 2.5, 0, 3, 0, D, 0, 0, 0, 10)
    return p.p

def _wedge(sb, mat, w, hb, hf, d, wf, x, y, z, rx):          # hood: box with a thinner, narrower front (+z) end
    hw, hd = w / 2, d / 2
    vs = [(-hw, -hb / 2, -hd), (hw, -hb / 2, -hd), (wf / 2, -hf / 2, hd), (-wf / 2, -hf / 2, hd),
          (-hw, hb / 2, -hd), (hw, hb / 2, -hd), (wf / 2, hf / 2, hd), (-wf / 2, hf / 2, hd)]
    faces = [(0, 1, 2, 3), (4, 7, 6, 5), (0, 4, 5, 1), (1, 5, 6, 2), (2, 6, 7, 3), (3, 7, 4, 0)]
    sb.p._emit(vs, faces, mat, Matrix.Translation((x, y, z)) @ Euler((rx, 0, 0), 'XYZ').to_matrix().to_4x4())

def _gable(sb, mat, ridge, w, d, a, rx):                     # pitched roof: two plates meeting at a ridge along local z, tilted rx about the ridge point
    pw = w / 4.0 + 0.1; th = 0.5
    for sg in (1, -1):
        c = (sg * pw / 2 * math.cos(a) , -pw / 2 * math.sin(a) - th / 2 * math.cos(a), 0)
        M = Matrix.Translation(ridge) @ Euler((rx, 0, 0), 'XYZ').to_matrix().to_4x4() @ Matrix.Translation(c) @ Euler((0, 0, -sg * a), 'XYZ').to_matrix().to_4x4()
        hw, hh, hd = pw / 2, th / 2, d / 2
        vs = [(-hw, -hh, -hd), (hw, -hh, -hd), (hw, -hh, hd), (-hw, -hh, hd), (-hw, hh, -hd), (hw, hh, -hd), (hw, hh, hd), (-hw, hh, hd)]
        sb.p._emit(vs, [(0, 1, 2, 3), (4, 7, 6, 5), (0, 4, 5, 1), (1, 5, 6, 2), (2, 6, 7, 3), (3, 7, 4, 0)], mat, M)

CA, SA = math.cos(0.16), math.sin(0.16)
def tp(x, y, z):                                             # a spec point rotated rx +0.16 about the carapace tier-1 centre (0, 14.25, -0.5)
    dy, dz = y - 14.25, z + 0.5
    return (x, 14.25 + dy * CA - dz * SA, -0.5 + dy * SA + dz * CA)

def mk_torso(side=0):
    t = SB('torso')
    # belly: bottom face inset to 11 wide, top stays 15
    t.box(11, 6, 14, 0, 3.5, 1, D, bev=.4, tx=15 / 11.0).box(20, 8, 17, 0, 9, 2, H, bev=.6, tx=.9, tz=.9)
    _wedge(t, 'hull', 16, 1.6, 0.6, 9, 13, 0, 11.2, 13.5, 0.5)                    # hood, steeper, thin toothed-looking front edge
    t.box(14, 3, 6, 0, 2.6, 11.5, H2, -0.4, bev=.3).box(13, 1.2, 1.6, 0, 3.4, 14.2, D)
    # carapace tier 1 + hump tilted 0.16 (front dips): the hunch
    t.box(24, 3.5, 19, 0, 14.25, -0.5, D, 0.16, bev=.45, tx=.93, tz=.93)
    x2, y2, z2 = tp(3.5, 17, -3.5); t.box(13, 2, 12, x2, y2, z2, H, 0.16, bev=.35)
    t.box(5, 6, 9, -11, 11, 1, D).box(6, 7, 10, 11.5, 11.5, 0.5, D).box(13, 9, 5, 0, 8, -8.5, D, bev=.3, tz=.7, tx=.9)
    # right pauldron: cap inset 0.6 per side, recoloured dark, brass strip at the front only
    t.box(9, 4, 10, -15, 14.5, 1, H, bev=.4).box(8.2, 0.7, 0.4, -15, 16.85, 5.4, T)
    _gable(t, 'dark', (-15, 17.4, 1), 8.2 * 2, 9.2, 0.2, 0)
    # LEFT GREAT PAULDRON: rx 0.16, top front edge pulled back 2.0, top outboard edge in 1.2, dark deck plate in a brass rim band
    t.box(11, 8, 14, 15.5, 14.5, 0.5, H, 0.16, bev=.6, tx=9.8 / 11, tz=12 / 14.0, sx=-0.6, sz=-1.0)
    _gable(t, 'dark', (14.9, 19.6, 0.31), 9.0 * 2, 11.5, 0.25, 0.16)
    t.box(11.4, 0.6, 14.4, 15.5, 18.15, 1.09, T, 0.16)
    t.box(5, 5, 0.5, 15.5, 13.5, 6.77, Bn, -0.085)
    t.box(3.5, 5, 0.5, 7, 9, 10.7, Bn).box(3.5, 5, 0.5, -7, 9, 10.7, Bn)
    for x in (5.5, 8.5):                                                             # stacks re-seated on the tilted tier 1
        _, ys, zs = tp(x, 17, -8); t.cyl(1.0, 1.3, 6, x, ys, zs, S, -0.25, 0, 0, 6)
    for i in range(-2, 3): t.box(1.1, 4, 1.1, i * 2.8, 1.2, 14.4, T)
    for x in (-5, 0, 5): t.box(1.2, 10, 1, x, 8, -11.3, T)
    for x in (0, 3.5, 7):                                                            # crest tines re-seated on the tilted hump
        _, yc, zc = tp(x, 18, 1.6); t.pyr(1.4, 2, x, yc - 0.3, zc, T)
    # glow (same node, glow / glow_hot slots)
    t.box(3, 5, 0.4, 2.5, 8, -11.05, hot).box(3, 5, 0.4, -2.5, 8, -11.05, hot).box(2.2, 2.2, 0.4, 15.5, 13.5, 7.05, g, 0, 0, q).box(1.6, 0.6, 0.4, 7, 6, 10.7, g).box(1.6, 0.6, 0.4, -7, 6, 10.7, g)
    return t.p

def mk_head(side=0):
    h = SB('head')
    h.box(6, 4, 6, 0, 0, 2.5, D, bev=.3).box(6.6, 1.4, 4, 0, 1.6, 4.4, H, 0.3, bev=.2).box(4.4, 1.8, 1, 0, -1.5, 5.9, T).cyl(0.6, 0.6, 1.6, 3.4, 0, 3, T, hp, 0, 0, 6).cyl(0.6, 0.6, 1.6, -3.4, 0, 3, T, hp, 0, 0, 6)
    h.box(4.6, 0.7, 0.4, 0, 0, 5.7, g)                  # visor slit (spec scales the glow colour 1.5x; done in the game material)
    return h.p

def mk_arm_r(side=0):
    a = SB('arm_R')
    a.cyl(2.6, 2.6, 3, -2, 0, 0, T, 0, 0, hp).box(6, 7, 12, -3.5, -2, 1, H, bev=.4).box(6.4, 0.8, 8, -3.5, 1.8, 1, T).box(5, 5, 5, -3.5, -2, -7, D, bev=.3)
    a.cyl(1.1, 1.1, 6, -7.1, -1, -2, Tk, hp, 0, 0, 6).cyl(1.1, 1.1, 6, -7.1, -3.6, -2, Tk, hp, 0, 0, 6).cyl(1.5, 1.8, 14, -3.5, -2, 14, D, hp).box(4, 4, 2.5, -3.5, -2, 21.5, D).box(1.2, 2, 10, -3.5, -5, 12, D)
    for z in (9, 11.5, 14, 16.5): a.box(4.6, 4.6, 0.6, -3.5, -2, z, T)
    return a.p

def mk_las_glow(side=0):
    l = SB('lascannon_glow')
    for z in (10.25, 12.75, 15.25): l.box(3.4, 3.4, 1.6, -3.5, -2, z, W)
    l.box(2.2, 2.2, 0.4, -3.5, -2, 22.9, W)
    return l.p

def mk_arm_l(side=0):
    a = SB('arm_L')
    a.cyl(3.4, 3.4, 7, 2, 0, 0, D, 0, 0, hp).box(6, 9, 6.5, 2, -4.5, 0, H, bev=.45).box(1, 6, 5, 5.4, -4.5, 0, H2).cyl(0.6, 0.6, 8, 2, -4.5, -3.8, T, 0, 0, 0, 6).cyl(3.6, 3.6, 7.5, 2, -9, 0, T, 0, 0, hp)
    return a.p

def mk_fore_l(side=0):
    f = SB('forearm_L')
    f.box(7.5, 7.5, 9, 2, 0, 5, H, bev=.45).box(8.2, 1.2, 7, 2, 4.2, 5, T).box(4, 0.5, 5, 2, 4.9, 5, Bn).box(4, 4, 4, 2, 0, -2.5, D).cyl(0.7, 0.7, 9, 6.3, -1, 5, D, hp, 0, 0, 6).cyl(0.7, 0.7, 9, -2.3, -1, 5, D, hp, 0, 0, 6)
    f.box(0.4, 1, 5, 6.0, 1.5, 5, hot).box(0.4, 1, 5, 6.0, -1.5, 5, hot)
    return f.p

def mk_fist(side=0):
    f = SB('fist_L')
    f.cyl(2.4, 2.4, 7, 0, 0, -2.5, S, hp).box(7, 7, 1.5, 0, 0, 1, D).box(9, 8.5, 5.5, 0, 0, 4.5, H, bev=.5).box(9.6, 3, 1.2, 0, 1.8, 7.6, T).box(8.6, 4, 1.4, 0, -2, 7.7, D).box(2.2, 4, 4.5, -5.4, -1, 5, D)
    for x in (-3.3, -1.1, 1.1, 3.3): f.box(1.6, 2.4, 1.6, x, 1.8, 8.6, D)
    return f.p

def mk_fist_glow(side=0):
    f = SB('fist_glow')
    for x in (-2.2, 0, 2.2): f.box(0.5, 2.6, 0.5, x, 1.8, 8.5, W)
    f.box(7, 0.5, 3, 0, 4.4, 4.5, W).box(0.5, 5, 3, 4.7, 0, 4.5, W)
    return f.p

def mk_rack(side=0):
    r = SB('rocket_rack')
    r.box(6, 2.2, 4, 0, -0.2, 0, D).box(8, 3.2, 6.4, 0, 2.2, 0, D, bev=.25).box(7.2, 0.5, 5.6, 0, 4.05, 0, D).box(7.2, 0.5, 0.4, 0, 4.05, 2.6, T)
    for y in (1.5, 2.9):
        for x in (-2.7, -0.9, 0.9, 2.7): r.box(1.3, 1.1, 0.3, x, y, 3.3, hot)
    return r.p

def mk_thigh(side=0):
    t = SB('thigh')
    t.box(5, 5.5, 11, 0, 0, 5.5, D, bev=.3, fz=.85).box(6.6, 2, 8.5, 0, 3.4, 5, H, bev=.35).box(3.4, 0.6, 5.5, 0, 4.6, 5, Bn).cyl(0.7, 0.7, 8, 0, -3.3, 5.5, T, hp, 0, 0, 6).cyl(3.3, 3.3, 6.4, 0, 0, 11, T, 0, 0, hp)
    return t.p

def mk_shin(side=0):
    s = SB('shin')
    s.box(4.6, 5, 11.5, 0, 0, 5.75, D, bev=.3, fz=.8).box(6.4, 2, 9, 0, 3.2, 6.5, H, bev=.35, fz=.8).box(6.4, 3, 5, 0, 3.8, 1, H2, bev=.3).pyr(2.4, 2.4, 0, 5.3, 1, T).cyl(0.6, 0.6, 8, 0, -3, 6, T, hp, 0, 0, 6).cyl(2.6, 2.6, 5.4, 0, 0, 11.5, D, 0, 0, hp)
    return s.p

def mk_foot(side=0):
    f = SB('foot')
    f.box(7.5, 1.8, 8, 0, 0.9, 0.5, D, bev=.25).box(3.2, 1.6, 3.6, 2.1, 0.8, 6.1, H, bev=.25).box(3.2, 1.6, 3.6, -2.1, 0.8, 6.1, H, bev=.25).box(3.6, 1.6, 2.6, 0, 0.8, -4.4, H, bev=.25).box(5.5, 2.2, 5, 0, 2.7, 0.3, H, bev=.3).box(7.9, 0.5, 8.4, 0, 1.9, 0.5, T)
    return f.p

# ------------------------------------------------------------------ assemble
HIP, HIPX, FOOTX, THIGHL, SHINL, FOOTH = 19.0, 6.97, 8.5, 11.0, 11.5, 2.5

def local_xform(ob, pivot, rot=(0, 0, 0)):          # parent-local pivot and rest rotation, both in game axes
    R = Euler(rot, 'XYZ').to_matrix()
    ob.matrix_basis = Matrix.Translation(g2b(pivot)) @ (C3 @ R @ C3.transposed()).to_4x4()

def build_harrow(side=0):
    ensure_materials()
    coll = bpy.data.collections.get(COLL)
    if not coll:
        coll = bpy.data.collections.new(COLL); bpy.context.scene.collection.children.link(coll)
    for o in list(coll.objects):
        m = o.data; bpy.data.objects.remove(o, do_unlink=True)
        if m and isinstance(m, bpy.types.Mesh) and m.users == 0: bpy.data.meshes.remove(m)
    for m in [m for m in bpy.data.meshes if m.users == 0]: bpy.data.meshes.remove(m)
    P = {'harrow': empty('harrow', coll, 4.0)}
    # name, builder, parent, pivot in parent (game), rest rotation (game x), per the spec's node table
    spec = [('pelvis', mk_pelvis, 'harrow', (0, HIP, 0), 0), ('torso', mk_torso, 'pelvis', (0, 3, 0), 0), ('head', mk_head, 'torso', (0, 7.2, 11.5), 0),
            ('arm_R', mk_arm_r, 'torso', (-12.5, 11, 1), 0), ('lascannon_glow', mk_las_glow, 'arm_R', (0, 0, 0), 0),
            ('arm_L', mk_arm_l, 'torso', (13, 11.5, 0.5), 0.15), ('forearm_L', mk_fore_l, 'arm_L', (0, -9, 0), 0.15),
            ('fist_L', mk_fist, 'forearm_L', (2, 0, 10), 0), ('fist_glow', mk_fist_glow, 'fist_L', (0, 0, 0), 0),
            ('rocket_rack', mk_rack, 'torso', (-7.5, 16, -4.5), -0.4)]
    for name, fn, par, piv, rx in spec:
        ob = fn(side).build(coll); ob.parent = P[par]; ob.matrix_parent_inverse = Matrix.Identity(4); local_xform(ob, piv, (rx, 0, 0)); P[name] = ob
    for name, par, piv in (('anchor_lascannon', 'arm_R', (-3.5, -2, 23)), ('anchor_fist', 'fist_L', (0, 0, 8.5)),
                           ('anchor_rack', 'rocket_rack', (0, 2.2, 3.4)), ('anchor_reactor', 'torso', (0, 8, -3))):
        e = empty(name, coll, 1.5); e.parent = P[par]; e.matrix_parent_inverse = Matrix.Identity(4); local_xform(e, piv); P[name] = e
    segs = {n: fn(side).build(coll) for n, fn in (('thigh', mk_thigh), ('shin', mk_shin), ('foot', mk_foot))}
    fwd = Vector((0, 0, 1))
    for sd, tag in ((1, 'L'), (-1, 'R')):
        hip = Vector((sd * HIPX, HIP, 0)); fpos = Vector((sd * FOOTX, 0, sd * 2.5)); ank = fpos + Vector((0, FOOTH, 0))
        d = ank - hip; L = d.length; d.normalize()
        a = math.acos(max(-1, min(1, (THIGHL ** 2 + L * L - SHINL ** 2) / (2 * THIGHL * L))))
        bend = fwd - d * fwd.dot(d); bend.normalize()
        knee = hip + d * math.cos(a) * THIGHL + bend * math.sin(a) * THIGHL
        for n, frm, to in (('thigh', hip, knee), ('shin', knee, ank)):
            if sd == 1: ob = segs[n]; ob.name = n + '_L'
            else: ob = bpy.data.objects.new(n + '_R', segs[n].data); coll.objects.link(ob)
            place(ob, frm, look_basis(frm, to)); ob.parent = P['harrow']; ob.matrix_parent_inverse = Matrix.Identity(4); P[ob.name] = ob
        if sd == 1: ob = segs['foot']; ob.name = 'foot_L'
        else: ob = bpy.data.objects.new('foot_R', segs['foot'].data); coll.objects.link(ob)
        place(ob, fpos); ob.parent = P['harrow']; ob.matrix_parent_inverse = Matrix.Identity(4); P[ob.name] = ob
    seen_m = set()
    for o in coll.objects:                                   # plate jitter +-6% (Part emits +-12%)
        if o.type != 'MESH' or o.data.name in seen_m: continue
        seen_m.add(o.data.name)
        for d in o.data.color_attributes['Color'].data:
            j = 0.94 + (d.color[0] - 0.88) / 0.24 * 0.12; d.color = (j, j, j, 1)
    bpy.context.view_layer.update()
    per = {o.name: sum(len(p.vertices) - 2 for p in o.data.polygons) for o in coll.objects if o.type == 'MESH'}
    uniq = {}
    for o in coll.objects:
        if o.type == 'MESH': uniq[o.data.name] = sum(len(p.vertices) - 2 for p in o.data.polygons)
    gm = lambda v: Vector((v.x, v.z, -v.y))     # blender world -> game
    anch = {n: [round(c, 2) for c in gm(P[n].matrix_world.translation)] for n in P if n.startswith('anchor')}
    piv = {n: [round(c, 2) for c in gm(P[n].matrix_world.translation)] for n in P if not n.startswith('anchor')}
    ys = [(o.matrix_world @ Vector(c)) for o in coll.objects if o.type == 'MESH' for c in o.bound_box]
    bb = [round(min(gm(v).x for v in ys), 1), round(max(gm(v).x for v in ys), 1), round(max(gm(v).y for v in ys), 1), round(min(gm(v).z for v in ys), 1), round(max(gm(v).z for v in ys), 1)]
    return {'tris_with_both_legs': sum(per.values()), 'tris_unique': sum(uniq.values()), 'per': per, 'anchors': anch, 'pivots': piv, 'bbox_xmin_xmax_ymax_zmin_zmax': bb}

# ------------------------------------------------------------------ bake / stage / render / export
def bake_ao(samples=32):
    sc = bpy.context.scene; coll = bpy.data.collections[COLL]
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
            v = col.data[i].color[0] * (0.55 + 0.45 * ao.data[i].color[0]); col.data[i].color = (v, v, v, 1)
        me.color_attributes.remove(me.color_attributes['AO'])
        me.color_attributes.active_color = me.color_attributes['Color']; me.color_attributes.render_color_index = 0

def make_stage():
    sc = bpy.context.scene
    if bpy.data.collections.get('Stage'): return
    st = bpy.data.collections.new('Stage'); sc.collection.children.link(st)
    cam = bpy.data.objects.new('Cam', bpy.data.cameras.new('Cam')); st.objects.link(cam); sc.camera = cam; cam.data.lens = 60; cam.data.clip_end = 3000
    for nm, e, rot, col in (('Key', 4.0, (0.9, 0.1, -0.7), (1, .93, .85)), ('Fill', 1.2, (1.1, 0, 2.2), (.6, .7, 1)), ('Rim', 0.35, (1.3, 0, 3.6), (1, .6, .35))):
        l = bpy.data.objects.new(nm, bpy.data.lights.new(nm, 'SUN')); l.data.energy = e; l.data.color = col; l.rotation_euler = rot; st.objects.link(l)
    me = bpy.data.meshes.new('Ground'); me.from_pydata([(-900, -900, 0), (900, -900, 0), (900, 900, 0), (-900, 900, 0)], [], [(0, 1, 2, 3)])
    gnd = bpy.data.objects.new('Ground', me); st.objects.link(gnd)
    gm = bpy.data.materials.new('ground'); gm.use_nodes = True; gm.node_tree.nodes['Principled BSDF'].inputs['Base Color'].default_value = (.22, .2, .19, 1); me.materials.append(gm)
    w = bpy.data.worlds.new('W'); sc.world = w; w.use_nodes = True
    w.node_tree.nodes['Background'].inputs[0].default_value = (.32, .34, .38, 1); w.node_tree.nodes['Background'].inputs[1].default_value = 0.7
    sc.render.engine = 'CYCLES'; sc.cycles.device = 'CPU'; sc.cycles.use_denoising = True
    sc.render.resolution_x = 1000; sc.render.resolution_y = 800; sc.view_settings.view_transform = 'Standard'

def shot(path, az, el=0.12, dist=125, tgt=(0, 0, 21), samples=32, lean=0.10):
    # az: 0 = camera in front (-y in blender, looking toward +y... i.e. looking at the engine's face); pi/2 = engine's right... see below
    sc = bpy.context.scene; cam = bpy.data.objects['Cam']; t = Vector(tgt)
    p = t + Vector((math.sin(az) * math.cos(el), -math.cos(az) * math.cos(el), math.sin(el))) * dist
    cam.location = p; cam.rotation_euler = (t - p).to_track_quat('-Z', 'Y').to_euler()
    pel = bpy.data.objects['pelvis']; pel.rotation_mode = 'XYZ'; pel.matrix_basis = Matrix.Translation(g2b((0, HIP, 0))) @ Euler((lean, 0, 0), 'XYZ').to_matrix().to_4x4()
    sc.cycles.samples = samples; sc.render.filepath = path; bpy.ops.render.render(write_still=True)
    pel.matrix_basis = Matrix.Translation(g2b((0, HIP, 0)))

def export_glb(path):
    coll = bpy.data.collections[COLL]
    bpy.ops.object.select_all(action='DESELECT')
    for o in coll.objects: o.select_set(True)
    bpy.context.view_layer.objects.active = bpy.data.objects['harrow']
    bpy.ops.export_scene.gltf(filepath=path, export_format='GLB', use_selection=True, export_yup=True, export_apply=False, export_animations=False,
                              export_texcoords=False, export_normals=True, export_materials='EXPORT', export_vertex_color='ACTIVE')
