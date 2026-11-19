# One-off export of the fleshbeast concept to a game-runtime GLB (not a pipeline).
#
#   blender.exe --background --factory-startup --python tools/export_fleshbeast.py -- \
#       <fleshbeast_v3.blend> <out.glb> [tex_size=2048] [bake_samples=16] [target_tris=38000]
#
# Source (read only, never saved): asset-pipeline/candidates/fleshbeast-20261119/fleshbeast_v3.blend,
# object 'Fleshbeast' (2.06M tris). Collapse-decimated copy, smart UV, Cycles CPU bakes from the
# original procedural material (diffuse colour incl. AO creases/veins) and a tangent normal map.
#
# RESULT (filled in after the run):
#   triangles : 37,994
#   file size : 2,539,688 bytes (2048 baseColor + 2048 tangent normal, JPEG q85, embedded)
#   bbox (m)  : x 2.501 (width) , y 1.767 (height), z 3.071 (depth), glTF axes
#   front     : creature front faces glTF +Z (Blender -Y, where the concept cameras stand)
#   origin    : ground-centre of the bbox (min y = 0), +Y up, metres, one mesh, one material, no armature

import sys
import os
import tempfile
import bpy
import bmesh
import numpy as np
from mathutils import Matrix

argv = sys.argv[sys.argv.index('--') + 1:]
SRC, OUT = argv[0], argv[1]
TEX = int(argv[2]) if len(argv) > 2 else 2048
SAMPLES = int(argv[3]) if len(argv) > 3 else 16
TARGET = int(argv[4]) if len(argv) > 4 else 38000
WORK = tempfile.mkdtemp(prefix='fleshbeast_bake_')  # scratch copies of the baked maps

bpy.ops.wm.open_mainfile(filepath=SRC)  # loaded only; no save anywhere in this script
hi = bpy.data.objects['Fleshbeast']
for o in list(bpy.data.objects):
    if o is not hi:
        bpy.data.objects.remove(o)
sc = bpy.context.scene
col = sc.collection

# --- low copy: triangulate then collapse decimate ------------------------------------------
me = hi.data.copy()
bm = bmesh.new()
bm.from_mesh(me)
bmesh.ops.triangulate(bm, faces=bm.faces)
bm.to_mesh(me)
bm.free()
lo = bpy.data.objects.new('FleshbeastLow', me)
col.objects.link(lo)
lo.data.materials.clear()
n_hi = len(me.polygons)
mod = lo.modifiers.new('dec', 'DECIMATE')
mod.decimate_type = 'COLLAPSE'
mod.ratio = TARGET / n_hi
mod.use_collapse_triangulate = True
mod.use_symmetry = False
dg = bpy.context.evaluated_depsgraph_get()
low_me = bpy.data.meshes.new_from_object(lo.evaluated_get(dg))
lo.modifiers.remove(mod)
old = lo.data
lo.data = low_me
bpy.data.meshes.remove(old)
low_me.polygons.foreach_set('use_smooth', [True] * len(low_me.polygons))
low_me.update()
print('LOW tris', len(low_me.polygons), 'from', n_hi)

# --- smart UV ---------------------------------------------------------------------------
for o in bpy.context.view_layer.objects:
    o.select_set(False)
bpy.context.view_layer.objects.active = lo
lo.select_set(True)
bpy.ops.object.mode_set(mode='EDIT')
bpy.ops.mesh.select_all(action='SELECT')
bpy.ops.uv.smart_project(angle_limit=1.15, island_margin=0.004)
bpy.ops.object.mode_set(mode='OBJECT')

# --- bake material target ------------------------------------------------------------------
def bake_image(name, colorspace):
    img = bpy.data.images.new(name, TEX, TEX, alpha=False)
    img.colorspace_settings.name = colorspace
    return img

col_img = bake_image('fleshbeast_basecolor', 'sRGB')
nrm_img = bake_image('fleshbeast_normal', 'Non-Color')
mat = bpy.data.materials.new('FleshbeastGame')
mat.use_nodes = True
nt = mat.node_tree
bsdf = nt.nodes['Principled BSDF']
bsdf.inputs['Roughness'].default_value = 0.45
bsdf.inputs['Metallic'].default_value = 0.0
tex_col = nt.nodes.new('ShaderNodeTexImage')
tex_col.image = col_img
tex_nrm = nt.nodes.new('ShaderNodeTexImage')
tex_nrm.image = nrm_img
nmap = nt.nodes.new('ShaderNodeNormalMap')
nt.links.new(tex_col.outputs['Color'], bsdf.inputs['Base Color'])
nt.links.new(tex_nrm.outputs['Color'], nmap.inputs['Color'])
nt.links.new(nmap.outputs['Normal'], bsdf.inputs['Normal'])
lo.data.materials.append(mat)

sc.render.engine = 'CYCLES'
sc.cycles.device = 'CPU'
sc.cycles.samples = SAMPLES
sc.cycles.use_denoising = False
b = sc.render.bake
b.use_selected_to_active = True
b.cage_extrusion = 0.03
b.max_ray_distance = 0.07
b.margin = 16
b.margin_type = 'EXTEND'
b.use_clear = True
b.normal_space = 'TANGENT'
b.target = 'IMAGE_TEXTURES'

def do_bake(btype, tex_node, **kw):
    nt.nodes.active = tex_node
    for o in bpy.context.view_layer.objects:
        o.select_set(False)
    hi.select_set(True)
    lo.select_set(True)
    bpy.context.view_layer.objects.active = lo
    bpy.ops.object.bake(type=btype, **kw)

do_bake('DIFFUSE', tex_col, pass_filter={'COLOR'})
print('BAKED colour')
do_bake('NORMAL', tex_nrm)
print('BAKED normal')
col_img.filepath_raw = os.path.join(WORK, 'basecolor.png')
col_img.file_format = 'PNG'
col_img.save()
nrm_img.filepath_raw = os.path.join(WORK, 'normal.png')
nrm_img.file_format = 'PNG'
nrm_img.save()

# --- origin to ground-centre (done after baking: the source material uses Object coords) ------
co = np.empty(len(low_me.vertices) * 3, dtype=np.float32)
low_me.vertices.foreach_get('co', co)
co = co.reshape(-1, 3)
mn, mx = co.min(0), co.max(0)
low_me.transform(Matrix.Translation((-(mn[0] + mx[0]) / 2, -(mn[1] + mx[1]) / 2, -mn[2])))
print('VALIDATE changed:', low_me.validate(verbose=True))
low_me.update()

# --- export (Blender Z-up -> glTF +Y up) ----------------------------------------------------
for o in bpy.context.view_layer.objects:
    o.select_set(False)
lo.select_set(True)
bpy.context.view_layer.objects.active = lo
bpy.ops.export_scene.gltf(
    filepath=OUT, export_format='GLB', use_selection=True, export_apply=True,
    export_yup=True, export_image_format='JPEG', export_jpeg_quality=85,
    export_materials='EXPORT', export_cameras=False, export_lights=False,
    export_normals=True, export_texcoords=True)
size = os.path.getsize(OUT)
dim = mx - mn
print('EXPORT tris', len(low_me.polygons), 'bytes', size,
      'bbox_blender_xyz', tuple(round(float(x), 3) for x in dim), '(glTF x,y,z = x,z,y)')
