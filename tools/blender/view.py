import bpy
import math
from mathutils import Vector

# camera matching the app's iso corner view: three [12.5,11,12.5] -> blender (12.5,-12.5,11)
cam_data = bpy.data.cameras.get('IsoCam') or bpy.data.cameras.new('IsoCam')
cam_data.type = 'ORTHO'
cam_data.ortho_scale = 19
cam = bpy.data.objects.get('IsoCamObj')
if not cam:
    cam = bpy.data.objects.new('IsoCamObj', cam_data)
    bpy.context.collection.objects.link(cam)
cam.location = Vector((12.5, -12.5, 11))
target = Vector((0, 0.4, 1.0))  # three (0,-1,-0.4)-ish but city-focused: look slightly up
direction = (Vector((0, 0, 1.2)) - cam.location).normalized()
cam.rotation_euler = direction.to_track_quat('-Z', 'Y').to_euler()
bpy.context.scene.camera = cam

# set every 3D viewport to material preview through this camera
for window in bpy.context.window_manager.windows:
    for area in window.screen.areas:
        if area.type == 'VIEW_3D':
            for space in area.spaces:
                if space.type == 'VIEW_3D':
                    space.shading.type = 'MATERIAL'
                    space.region_3d.view_perspective = 'CAMERA'
                    space.overlay.show_overlays = False
print('view set')
