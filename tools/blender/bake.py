import bpy
import time
import os

scene = bpy.context.scene
SCRATCH = '/tmp/detroit-bake'
os.makedirs(SCRATCH, exist_ok=True)

# ---------------------------------------------------------------- GPU + Cycles
scene.render.engine = 'CYCLES'
try:
    prefs = bpy.context.preferences.addons['cycles'].preferences
    prefs.compute_device_type = 'METAL'
    prefs.get_devices()
    for d in prefs.devices:
        d.use = True
    scene.cycles.device = 'GPU'
    print('metal gpu on')
except Exception as e:
    scene.cycles.device = 'CPU'
    print('gpu setup failed, cpu:', e)

scene.cycles.samples = 128
scene.cycles.use_adaptive_sampling = True

# ---------------------------------------------------------------- retune object-space scales to world space (post-join)
def hex2lin(h):
    h = h.lstrip('#')
    return tuple(pow(int(h[i:i + 2], 16) / 255.0, 2.2) for i in (0, 2, 4))

def set_tex(matname, ttype, **inputs):
    m = bpy.data.materials.get(matname)
    if not m:
        return
    for n in m.node_tree.nodes:
        if n.type == ttype:
            for k, v in inputs.items():
                n.inputs[k].default_value = v

set_tex('sidewalk', 'TEX_BRICK', Scale=2.82, **{'Mortar Size': 0.012})
set_tex('concrete', 'TEX_NOISE', Scale=0.35)
set_tex('asphalt', 'TEX_NOISE', Scale=1.1)
set_tex('infield', 'TEX_NOISE', Scale=4.0)
for hx in ['#8f8578', '#9aa1a8', '#7d848e', '#a89a8c', '#8a9099', '#b5aa9a',
           '#9c6b52', '#8b94a3', '#bc6e42', '#c9b797', '#6a5f52', '#5f5549',
           '#544b41', '#d9cdb4']:
    set_tex('wall' + hx, 'TEX_NOISE', Scale=7.0)

# ---------------------------------------------------------------- group + join
GROUND_PREFIX = ('slab', 'ground', 'riverwalk', 'apron', 'ave', 'ring', 'arc', 'dash', 'xw',
                 'bridgedeck', 'cm', 'gc', 'field', 'infield')

ground_objs, bldg_objs = [], []
for o in bpy.data.objects:
    if o.type != 'MESH':
        continue
    (ground_objs if o.name.startswith(GROUND_PREFIX) else bldg_objs).append(o)

def join(objs, name):
    bpy.ops.object.select_all(action='DESELECT')
    for o in objs:
        o.select_set(True)
    bpy.context.view_layer.objects.active = objs[0]
    bpy.ops.object.convert(target='MESH')  # apply modifiers
    bpy.ops.object.join()
    j = bpy.context.active_object
    j.name = name
    return j

ground = join(ground_objs, 'CityGround')
bldgs = join(bldg_objs, 'CityBuildings')
print('joined:', len(ground.data.polygons), len(bldgs.data.polygons))

# ---------------------------------------------------------------- UV + bake image
def prep(obj, imgname, size, margin):
    bpy.ops.object.select_all(action='DESELECT')
    obj.select_set(True)
    bpy.context.view_layer.objects.active = obj
    bpy.ops.object.mode_set(mode='EDIT')
    bpy.ops.mesh.select_all(action='SELECT')
    bpy.ops.uv.smart_project(angle_limit=1.15, island_margin=margin)
    bpy.ops.object.mode_set(mode='OBJECT')
    img = bpy.data.images.new(imgname, size, size, alpha=False)
    for slot in obj.material_slots:
        nt = slot.material.node_tree
        node = nt.nodes.new('ShaderNodeTexImage')
        node.image = img
        nt.nodes.active = node
    return img

img_g = prep(ground, 'GroundAtlas', 4096, 0.003)
img_b = prep(bldgs, 'BuildingsAtlas', 8192, 0.001)
print('uv done')

# ---------------------------------------------------------------- bake
bake = scene.render.bake
bake.use_pass_direct = True
bake.use_pass_indirect = True
bake.use_pass_emit = True
bake.use_pass_diffuse = True
bake.use_pass_glossy = False
bake.use_pass_transmission = False
bake.margin = 8

for obj, img, fname in ((ground, img_g, 'ground-atlas.png'), (bldgs, img_b, 'buildings-atlas.png')):
    bpy.ops.object.select_all(action='DESELECT')
    obj.select_set(True)
    bpy.context.view_layer.objects.active = obj
    t = time.time()
    bpy.ops.object.bake(type='COMBINED')
    img.filepath_raw = f'{SCRATCH}/{fname}'
    img.file_format = 'PNG'
    img.save()
    print(f'baked {obj.name} in {time.time() - t:.0f}s')

print('BAKE DONE')
