# Hierarch-class battle colossus: geometry source. Executed inside the Blender MCP session AFTER build_scout.py has been
# exec'd into the same namespace (it provides Part, empty, g2b, place, look_basis, bake_ao, shot).
# GAME coordinates throughout: x = walker's left, y = up, z = forward, metres.
import bpy, math
from mathutils import Vector, Matrix, Euler

MATNAMES[:] = ['hull', 'hull2', 'dark', 'trim', 'bone', 'soot', 'tank', 'glow', 'glow_hot', 'glow_charge']
HH = 28.0                                  # hip height at rest
H_THIGH, H_SHIN, H_FOOT = 14.0, 14.5, 3.0  # plantigrade: two segments, ankle 3 m above the sole
H_HIPX, H_FOOTX = 7.4, 9.0
SQ = math.sqrt(2)

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

def pyr(p, mat, w, h, x, y, z, d=None):          # square (or rectangular) spirelet, base at y
    if d is None: p.cyl(mat, 0.02, w / SQ, h, x, y + h / 2, z, seg=4)
    else: p.box(mat, w, h, d, x, y + h / 2, z, tx=.03, tz=.03)

def spire(p, x, y, z, w, h, cap, mat='dark'):    # shaft + trim spirelet: the cathedral motif of the great colossi, small
    p.box(mat, w, h, w, x, y + h / 2, z, bev=w * .06)
    p.box('trim', w * 1.25, w * .22, w * 1.25, x, y + h + w * .1, z)
    pyr(p, 'trim', w * 1.2, cap, x, y + h + w * .2, z)

# ------------------------------------------------------------------ parts
def h_pelvis():
    p = Part('pelvis')
    p.box('dark', 15, 5, 9.5, 0, 0, 0, bev=.4, tx=.9, tz=.9)
    p.cyl('dark', 2.6, 2.6, 13, 0, 0, 0, rz=HP, seg=10)
    for s in (1, -1):
        p.cyl('trim', 3.9, 3.9, .9, s * 4.3, 0, 0, rz=HP, seg=12)
        p.box('dark', 2.2, 2.4, 7.5, s * 3.0, -2.8, -.3, bev=.2)
    p.box('trim', 15.6, .7, 10, 0, 2.7, 0, bev=.15)
    p.box('dark', 8, 4.4, 6.5, 0, -3.6, 0, bev=.3, tx=1.15)
    # tabards front and rear, as the great colossi wear them
    p.box('bone', 5.2, 12, .5, 0, -8.5, 5.0, tx=1.25, bev=.1)
    p.box('hull2', 1.3, 10, .3, 0, -8.2, 5.35)
    p.box('dark', 2.8, 2.8, .35, 0, -5.5, 5.45, rz=math.pi / 4)
    p.box('trim', 6.8, .7, .8, 0, -2.6, 5.1)
    p.box('bone', 4.2, 9, .45, 0, -7.2, -5.0, tx=1.25, bev=.1)
    p.box('dark', 5.5, 3.4, 4.0, 0, .4, -6.2, bev=.3, tz=.7, sz=.4)
    return p

def h_torso():
    t = Part('torso')
    t.cyl('dark', 4.6, 5.2, 3.2, 0, 1.3, 0, seg=12)
    t.cyl('trim', 5.5, 5.5, .6, 0, 2.9, 0, seg=12)
    t.box('dark', 13, 3.4, 11, 0, 4.4, .4, bev=.3, tx=1.3, tz=1.1)                    # abdomen flaring to the chest
    t.box('hull', 20, 9.5, 13, 0, 10.4, 0, bev=.5, tx=.94, tz=.9)                     # chest block
    t.box('hull', 14, 7, 5.2, 0, 9.4, 7.2, bev=.4, tz=.45, sz=-1.2, fz=.8)            # sloped breastplate prow
    t.box('trim', 14.6, .8, 5.6, 0, 5.9, 7.0, bev=.12, fz=.82)
    t.box('hull2', 3.2, 6.2, .4, 0, 9.1, 9.25, rx=-.33)                                # livery stripe down the prow
    t.box('dark', 2.6, 2.6, .5, 0, 9.6, 9.5, rx=-.33, rz=math.pi / 4)
    t.box('dark', 15, 7.5, 4.2, 0, 9.6, -7.6, bev=.35, tz=.75, sz=.5)                 # reactor housing on the back
    t.box('soot', 10, 4.6, .5, 0, 9.4, -9.9, rx=.08)
    for i in range(4): t.box('glow_hot', 8.4, .5, .3, 0, 7.8 + i * 1.05, -10.2 + i * .06)
    for s in (1, -1):
        t.box('trim', 1.4, 9.5, 1.0, s * 6.6, 9.4, -9.9)                               # reactor buttresses
        # shoulders: broad blocks capped in trim, heraldic boss on the face
        t.box('hull', 8.2, 7.4, 13.6, s * 13.6, 11.2, 0, bev=.45, tx=.9, tz=.9)
        t.box('trim', 8.8, .8, 14.2, s * 13.6, 15.2, 0, bev=.15)
        t.box('bone', 4.2, 4.2, .4, s * 13.6, 11.2, 6.75)
        t.box('dark', 2.3, 2.3, .4, s * 13.6, 11.2, 6.95, rz=math.pi / 4)
        t.box('glow', 1.1, 1.1, .3, s * 13.6, 11.2, 7.15)
        t.cyl('dark', 2.6, 2.6, 3.2, s * 13.6, 6.4, 1.5, seg=10)                       # arm gimbal under the shoulder
        t.box('hull', 1.4, 5.2, 12, s * 18.0, 10.4, 0, rz=-s * .12, bev=.2)            # shoulder skirt
        t.cyl('soot', 1.1, 1.3, 7.5, s * 7.6, 20.5, -6.4, seg=8); t.cyl('trim', 1.5, 1.5, .5, s * 7.6, 24.3, -6.4, seg=8)   # stacks
        t.cyl('soot', .8, 1.0, 5.4, s * 9.9, 19.4, -3.4, seg=8)
    # carapace deck
    t.box('dark', 23.5, 2.4, 15.2, 0, 16.3, -.4, bev=.3, tx=.95, tz=.93)
    t.box('trim', 22.4, .5, .7, 0, 17.4, 6.5)
    # cathedral: a roofed nave between corner spirelets, one tall spire behind
    t.box('dark', 7.4, 5.6, 9.6, 0, 20.3, -1.4, bev=.25)
    pyr(t, 'trim', 7.9, 3.6, 0, 23.1, -1.4, d=10.2)
    for i in (-1, 0, 1):
        t.box('glow', .9, 2.9, .3, i * 2.1, 20.2, 3.5)                                 # lancet windows
        for s in (1, -1): t.box('glow', .3, 3.0, .9, s * 3.78, 20.2, -1.4 + i * 2.8)
    for s in (1, -1):
        spire(t, s * 5.3, 17.5, -4.6, 2.0, 7.4, 4.6); spire(t, s * 5.3, 17.5, 3.4, 1.5, 4.4, 3.0)
        t.box('dark', 1.6, .7, 3.2, s * 4.6, 21.6, -4.6, rz=s * .5)                    # flying buttresses to the nave
    spire(t, 0, 17.5, -4.9, 2.6, 8.0, 5.6); t.box('dark', .35, 3.0, .35, 0, 33.2, -4.9)
    return t

def h_head():
    h = Part('head')
    h.cyl('dark', 1.7, 1.7, 3.0, 0, -.2, -1.2, rx=HP, seg=8)
    h.box('hull', 5.4, 4.0, 5.6, 0, 0, 1.6, bev=.3, tx=.8, tz=.8, sz=-.5, fz=.78)      # helm
    h.box('dark', 4.4, 2.0, 4.2, 0, -2.4, 1.9, bev=.2, tx=1.1, fz=.8)                  # gorget / jaw
    h.box('trim', 5.0, .7, 2.4, 0, 1.2, 3.5, rx=.3, bev=.15, fz=.85)                   # brow
    h.box('soot', 4.0, 1.0, .4, 0, .15, 4.36)
    h.box('glow', 3.4, .45, .3, 0, .15, 4.52)                                           # visor slit
    for i in range(-3, 4): h.box('trim', .22, 1.7, .3, i * .55, -2.4, 4.0)             # grille
    h.box('soot', 3.8, 1.6, .3, 0, -2.4, 3.86)
    h.box('hull2', 1.0, 1.1, 4.6, 0, 2.3, 1.0, tz=.75, sz=-.3, bev=.1)                 # crest
    pyr(h, 'trim', 1.1, 2.2, 0, 2.8, -.6)
    for s in (1, -1): h.cyl('dark', .8, .8, 1.4, s * 2.9, -.4, 1.0, rz=HP, seg=8)
    return h

def h_arm_l():                                   # rotary macro-cannon housing (walker's left, +x)
    a = Part('arm_L')
    a.box('hull', 6.2, 6.6, 11.5, 0, -2, 1.5, bev=.35)
    a.box('trim', 6.8, .9, 5.5, 0, 1.6, 1.5, bev=.15)
    a.box('dark', 4.4, 5.4, 4.6, 0, -2.4, -5.6, bev=.25)                                # counterweight
    a.box('hull2', 6.3, 1.6, 2.6, 0, -1.0, 4.6)
    a.cyl('dark', 2.9, 2.9, 3.4, 0, -2, 8.6, rx=HP, seg=12)                            # bearing collar
    a.cyl('dark', 2.4, 2.4, 4.4, 3.6, -2.6, -.6, rz=HP, seg=10); a.cyl('trim', 2.6, 2.6, .5, 4.4, -2.6, -.6, rz=HP, seg=10)   # ammunition drum, outboard
    a.box('dark', 1.6, 1.4, 5.0, 2.6, -.4, 3.2, rx=.3)                                  # feed
    for z in (-1, 1, 3): a.box('soot', .4, 3.6, 1.0, -3.15, -2, z)
    return a

def h_barrels():                                 # spins about local z; origin on the barrel axis
    b = Part('barrels_L')
    for i in range(5):
        an = i / 5 * 2 * math.pi + .3
        b.cyl('soot', .68, .68, 13.5, math.cos(an) * 1.75, math.sin(an) * 1.75, 15.5, rx=HP, seg=6)
    for z in (10.6, 15.5, 21.2): b.cyl('dark', 2.75, 2.75, .8, 0, 0, z, rx=HP, seg=12)
    b.cyl('trim', .8, .8, 12, 0, 0, 15.5, rx=HP, seg=6)
    return b

def h_arm_r():                                   # fusion blaster (walker's right, -x)
    r = Part('arm_R')
    r.box('hull', 6.2, 7.0, 12, 0, -2, 1.5, bev=.35)
    r.box('trim', 6.8, .9, 5.5, 0, 1.8, 1.5, bev=.15)
    r.box('dark', 4.4, 5.6, 4.8, 0, -2.4, -5.8, bev=.25)
    r.box('hull2', 6.3, 1.6, 2.6, 0, -1.0, 4.8)
    r.cyl('dark', 1.55, 1.95, 13.5, 0, -2, 14.4, rx=HP, seg=10)                        # emitter barrel
    for z in (9.2, 12.6, 16.0): r.cyl('trim', 2.55, 2.55, .8, 0, -2, z, rx=HP, seg=10)  # focusing rings
    for k in range(4):                                                                  # radial heat vanes
        an = k * HP + HP / 2
        r.box('dark', .45, 1.7, 6.0, math.cos(an) * 2.5, -2 + math.sin(an) * 2.5, 12.6, rz=an - HP)
    r.cyl('soot', 2.5, 1.6, 2.6, 0, -2, 22.0, rx=HP, seg=10, caps='bottom')            # muzzle bell
    for s in (1, -1): r.cyl('tank', 1.1, 1.1, 6.5, s * 1.7, 2.6, -1.0, rx=HP, seg=8)   # plasma flasks on top
    r.cyl('trim', .3, .3, 9, 2.2, .6, 6.0, rx=HP - .25, seg=5)
    for z in (-1, 1, 3): r.box('soot', .4, 3.8, 1.0, 3.15, -2, z)
    return r

def h_glow():                                    # charge tell: coils between the rings and the throat of the bell
    g = Part('blaster_glow')
    for z in (10.9, 14.3, 17.7): g.cyl('glow_charge', 2.15, 2.15, .9, 0, -2, z, rx=HP, seg=10, caps=False)
    g.cyl('glow_charge', 2.2, 1.45, 2.2, 0, -2, 22.1, rx=HP, seg=10, caps='bottom', flip=True)
    return g

def h_pod():                                     # carapace missile pod on the left shoulder
    k = Part('missile_pod')
    k.box('dark', 4.2, 1.6, 4.6, 0, .6, 0, bev=.2)
    k.at(0, 3.2, .3, rx=-.32)
    k.box('dark', 7.2, 3.8, 8.2, 0, 0, 0, bev=.3)
    k.box('trim', 7.7, .6, 8.6, 0, 2.1, -.3, bev=.12)
    k.box('soot', 6.6, 3.2, .3, 0, 0, 4.1)
    for i in range(6): k.box('glow_hot', 1.3, 1.1, .3, (i % 3 - 1) * 2.1, (i // 3) * 1.5 - .75, 4.25)
    k.box('hull2', 7.25, 1.2, 1.6, 0, -.6, -2.0)
    k.at()
    return k

def h_thigh():
    th = Part('thigh')
    th.cyl('dark', 3.4, 3.4, 5.6, 0, 0, 0, rz=HP, seg=12)
    th.cyl('trim', 2.2, 2.2, 6.2, 0, 0, 0, rz=HP, seg=8)
    th.box('hull', 5.6, 6.0, 11, 0, 0, 7.0, bev=.35)
    th.box('hull', 6.6, 1.7, 10, 0, 3.3, 6.8, bev=.3, tz=.88)                           # cuisse
    th.box('bone', 3.6, .4, 6.0, 0, 4.25, 6.6); th.box('hull2', 1.1, .3, 6.0, 0, 4.5, 6.6)
    for s in (1, -1): th.cyl('trim', .6, .6, 9.5, s * 1.5, -3.2, 7.0, rx=HP, seg=6)
    th.box('dark', 3.6, 1.8, 2.6, 0, -2.9, 2.4)
    th.cyl('dark', 3.0, 3.0, 6.2, 0, 0, H_THIGH, rz=HP, seg=12)                          # knee
    return th

def h_shin():
    sh = Part('shin')
    sh.box('dark', 5.2, 5.4, 12.5, 0, 0, 7.4, bev=.3)
    sh.box('hull', 6.8, 1.8, 11, 0, 3.1, 7.6, bev=.28, tz=.9)                            # greave
    sh.box('hull', 7.4, 2.6, 4.6, 0, 3.5, 1.8, bev=.3)                                   # knee cop
    sh.box('trim', 7.7, .5, 4.9, 0, 5.0, 1.8)
    pyr(sh, 'trim', 2.2, 2.6, 0, 5.1, 1.8)                                               # spirelet on the knee, as the great colossi
    sh.box('hull2', 1.1, .3, 7.0, 0, 3.95, 8.4)
    sh.cyl('trim', .55, .55, 10, 1.3, -2.9, 7.6, rx=HP, seg=6)
    sh.box('hull', 5.2, 3.6, 3.0, 0, 0, 13.2, bev=.25, tx=1.1)                           # ankle skirt
    sh.cyl('dark', 2.5, 2.5, 5.4, 0, 0, H_SHIN, rz=HP, seg=10)                           # ankle
    return sh

def h_foot():                                    # 17.8 m heel to toe = two tank lengths
    f = Part('foot')
    f.box('dark', 8.0, 2.2, 11, 0, 1.1, 1.0, bev=.3)
    f.box('trim', 8.5, .6, 11.5, 0, 2.3, 1.0, bev=.12)
    f.box('hull', 5.4, 2.8, 6.6, 0, 3.6, .2, bev=.3, tx=.75, tz=.75)                     # ankle housing
    for s in (1, -1):
        f.box('hull', 3.3, 2.0, 5.2, s * 2.2, 1.0, 7.0, bev=.25, tz=.6, sz=-.9, tx=.85)  # toes
        f.box('soot', 2.6, .9, 1.2, s * 2.2, .45, 9.0)
    f.box('hull', 3.8, 1.9, 4.6, 0, .95, -5.9, bev=.25, tz=.6, sz=.8, tx=.85)            # heel
    return f

# ------------------------------------------------------------------ assemble
def build_hierarch():
    ensure_materials()
    coll = bpy.data.collections.get('Hierarch')
    if not coll:
        coll = bpy.data.collections.new('Hierarch'); bpy.context.scene.collection.children.link(coll)
    for o in list(coll.objects):
        m = o.data; bpy.data.objects.remove(o, do_unlink=True)
        if m and isinstance(m, bpy.types.Mesh) and m.users == 0: bpy.data.meshes.remove(m)
    P = {'hierarch': empty('hierarch', coll, 4.0)}
    T = Vector((0, HH + 3.0, 0))                                    # waist pivot
    AL, AR = T + Vector((13.6, 6.4, 1.5)), T + Vector((-13.6, 6.4, 1.5))
    POD = T + Vector((13.6, 15.6, -2.0))
    spec = [('pelvis', h_pelvis, 'hierarch', (0, HH, 0)), ('torso', h_torso, 'pelvis', T), ('head', h_head, 'torso', T + Vector((0, 10.2, 9.6))),
            ('arm_L', h_arm_l, 'torso', AL), ('barrels_L', h_barrels, 'arm_L', AL + Vector((0, -2, 0))),
            ('arm_R', h_arm_r, 'torso', AR), ('blaster_glow', h_glow, 'arm_R', AR),
            ('missile_pod', h_pod, 'torso', POD)]
    for name, fn, par, org in spec:
        ob = fn().build(coll); place(ob, org); P[name] = ob
    for name, par, org in (('anchor_cannon', 'arm_L', (0, -2, 22.6)), ('anchor_blaster', 'arm_R', (0, -2, 23.6)),
                           ('anchor_pod', 'missile_pod', (0, 4.6, 4.6)), ('anchor_reactor', 'torso', (0, 9.5, -3.0))):
        e = empty(name, coll, 1.5); e.matrix_world = Matrix.Translation(P[par].matrix_world.translation + g2b(org)); P[name] = e; spec.append((name, None, par, None))
    segs = {n: fn().build(coll) for n, fn in (('thigh', h_thigh), ('shin', h_shin), ('foot', h_foot))}
    fwd = Vector((0, 0, 1))
    for side, tag, fz in ((1, 'L', 1.6), (-1, 'R', -1.6)):
        hip = Vector((side * H_HIPX, HH, 0)); fpos = Vector((side * H_FOOTX, 0, fz)); ank = fpos + Vector((0, H_FOOT, 0))
        d = ank - hip; L = d.length; d.normalize()
        a = math.acos(max(-1, min(1, (H_THIGH ** 2 + L * L - H_SHIN ** 2) / (2 * H_THIGH * L))))
        bend = fwd - d * fwd.dot(d); bend.normalize()
        knee = hip + d * math.cos(a) * H_THIGH + bend * math.sin(a) * H_THIGH
        for n, frm, to in (('thigh', hip, knee), ('shin', knee, ank)):
            if side == 1: ob = segs[n]; ob.name = n + '_L'
            else: ob = bpy.data.objects.new(n + '_R', segs[n].data); coll.objects.link(ob)
            place(ob, frm, look_basis(frm, to)); P[ob.name] = ob; spec.append((ob.name, None, 'hierarch', None))
        if side == 1: ob = segs['foot']; ob.name = 'foot_L'
        else: ob = bpy.data.objects.new('foot_R', segs['foot'].data); coll.objects.link(ob)
        place(ob, fpos); P[ob.name] = ob; spec.append((ob.name, None, 'hierarch', None))
    bpy.context.view_layer.update()
    for name, fn, par, org in spec:
        ob = P[name]; mw = ob.matrix_world.copy(); ob.parent = P[par]; ob.matrix_parent_inverse = Matrix.Identity(4); ob.matrix_world = mw
    bpy.context.view_layer.update()
    per = {o.name: sum(len(p.vertices) - 2 for p in o.data.polygons) for o in coll.objects if o.type == 'MESH'}
    zs = [(o.matrix_world @ Vector(c)).z for o in coll.objects if o.type == 'MESH' for c in o.bound_box]
    return {'tris': sum(per.values()), 'per': per, 'height': max(zs)}

def make_stage():
    sc = bpy.context.scene
    st = bpy.data.collections.get('Stage')
    if st: return
    st = bpy.data.collections.new('Stage'); sc.collection.children.link(st)
    cam = bpy.data.objects.new('Cam', bpy.data.cameras.new('Cam')); st.objects.link(cam); sc.camera = cam; cam.data.lens = 60; cam.data.clip_end = 3000
    for nm, e, rot, col in (('Key', 4.0, (0.9, 0.1, -0.7), (1, .93, .85)), ('Fill', 1.2, (1.1, 0, 2.2), (.6, .7, 1)), ('Rim', 0.35, (1.3, 0, 3.6), (1, .6, .35))):
        l = bpy.data.objects.new(nm, bpy.data.lights.new(nm, 'SUN')); l.data.energy = e; l.data.color = col; l.rotation_euler = rot; st.objects.link(l)
    me = bpy.data.meshes.new('Ground'); me.from_pydata([(-900, -900, 0), (900, -900, 0), (900, 900, 0), (-900, 900, 0)], [], [(0, 1, 2, 3)])
    g = bpy.data.objects.new('Ground', me); st.objects.link(g)
    gm = bpy.data.materials.new('ground'); gm.use_nodes = True; gm.node_tree.nodes['Principled BSDF'].inputs['Base Color'].default_value = (.22, .2, .19, 1); me.materials.append(gm)
    w = bpy.data.worlds.new('W'); sc.world = w; w.use_nodes = True
    w.node_tree.nodes['Background'].inputs[0].default_value = (.32, .34, .38, 1); w.node_tree.nodes['Background'].inputs[1].default_value = 0.7
    sc.render.engine = 'CYCLES'; sc.cycles.device = 'CPU'; sc.cycles.use_denoising = True
    sc.render.resolution_x = 1000; sc.render.resolution_y = 800; sc.view_settings.view_transform = 'Standard'
