import bpy
from mathutils import Vector

def P(x, y, z):
    """three.js (x, y-up, z) -> blender (x, -z, y)"""
    return Vector((x, -z, y))

def baked_mat(name, imgname):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    nt = m.node_tree
    b = nt.nodes['Principled BSDF']
    b.inputs['Roughness'].default_value = 1.0
    tex = nt.nodes.new('ShaderNodeTexImage')
    tex.image = bpy.data.images[imgname]
    nt.links.new(tex.outputs['Color'], b.inputs['Base Color'])
    return m

ground = bpy.data.objects['CityGround']
bldgs = bpy.data.objects['CityBuildings']
for obj, name, img in ((ground, 'GroundBaked', 'GroundAtlas'), (bldgs, 'BuildingsBaked', 'BuildingsAtlas')):
    m = baked_mat(name, img)
    obj.data.materials.clear()
    obj.data.materials.append(m)

# verify render with baked materials (flat, lighting already in the texture)
scene = bpy.context.scene
scene.render.engine = 'BLENDER_EEVEE'
scene.render.resolution_x = 1400
scene.render.resolution_y = 1000
scene.render.filepath = '/tmp/detroit-bake/render_baked.png'
scene.render.image_settings.file_format = 'PNG'
scene.render.film_transparent = False
scene.view_settings.look = 'AgX - Medium High Contrast'

# Match the app's fixed isometric orthographic view for the verification render.
cam_data = bpy.data.cameras.new('DetroitPreviewCamera')
cam_data.type = 'ORTHO'
cam_data.ortho_scale = 12.5
cam = bpy.data.objects.new('DetroitPreviewCamera', cam_data)
bpy.context.collection.objects.link(cam)
cam.location = P(14, 9, 14)
cam.rotation_euler = (P(0, 0.6, 0) - cam.location).to_track_quat('-Z', 'Y').to_euler()
scene.camera = cam
# kill the lights so we see only the baked texture (approximate three MeshBasicMaterial)
sun = bpy.data.objects.get('Sun')
if sun:
    sun.hide_render = True
world = scene.world
world.node_tree.nodes['Background'].inputs['Strength'].default_value = 1.0
# emission-only preview: temporarily boost by using emission from image? simpler: keep principled and strong even world light
bpy.ops.render.render(write_still=True)

bpy.ops.object.select_all(action='DESELECT')
ground.select_set(True)
bldgs.select_set(True)
bpy.ops.export_scene.gltf(
    filepath='/Users/mattgreenberg/dev/demos/grass/public/detroit.glb',
    export_format='GLB',
    use_selection=True,
    export_image_format='JPEG',
    export_jpeg_quality=90,
    export_apply=True,
)
bpy.ops.wm.save_as_mainfile(filepath='/tmp/detroit-bake/detroit.blend')
print('EXPORTED')
