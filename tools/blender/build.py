import bpy
import bmesh
import math
import random
from mathutils import Vector

# Detroit diorama v3 — "postcard from Windsor" composition.
# The Detroit River runs along +z (the NEAR edge from the app's iso corner
# camera), so the water sits in the foreground with Hart Plaza and the dense
# financial-district skyline right behind it (RenCen anchoring the right).
# Behind the cluster, Woodward's baroque radial plan spreads north: Campus
# Martius hub with concentric ring road + arcs, radial avenues, Grand Circus
# half-park. The People Mover ring circles the core (procedural in City.jsx).
# North in this file = -z (away from the river/camera).

rnd = random.Random(20241)

for obj in list(bpy.data.objects):
    bpy.data.objects.remove(obj, do_unlink=True)
for coll in (bpy.data.meshes, bpy.data.materials, bpy.data.curves,
             bpy.data.lights, bpy.data.cameras, bpy.data.images):
    for b in list(coll):
        if b.users == 0:
            try:
                coll.remove(b)
            except Exception:
                pass

scene = bpy.context.scene

def P(x, y, z):
    """three.js (x, y-up, z) -> blender (x, -z, y)"""
    return Vector((x, -z, y))

def rot2(dx, dz, a):
    c, s = math.cos(a), math.sin(a)
    return (dx * c + dz * s, -dx * s + dz * c)

def hex2lin(h):
    h = h.lstrip('#')
    return tuple(pow(int(h[i:i + 2], 16) / 255.0, 2.2) for i in (0, 2, 4))

MATS = {}

def mat(name, color=None, rough=0.85, emit=None, emit_strength=0.0):
    if name in MATS:
        return MATS[name]
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    b = m.node_tree.nodes['Principled BSDF']
    if color:
        b.inputs['Base Color'].default_value = (*hex2lin(color), 1)
    b.inputs['Roughness'].default_value = rough
    if emit:
        b.inputs['Emission Color'].default_value = (*hex2lin(emit), 1)
        b.inputs['Emission Strength'].default_value = emit_strength
    MATS[name] = m
    return m

def noisy_mat(name, c1, c2, scale=8.0, rough=0.9, detail=2.0):
    if name in MATS:
        return MATS[name]
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    nt = m.node_tree
    b = nt.nodes['Principled BSDF']
    b.inputs['Roughness'].default_value = rough
    tex = nt.nodes.new('ShaderNodeTexNoise')
    tex.inputs['Scale'].default_value = scale
    tex.inputs['Detail'].default_value = detail
    ramp = nt.nodes.new('ShaderNodeValToRGB')
    ramp.color_ramp.elements[0].color = (*hex2lin(c1), 1)
    ramp.color_ramp.elements[1].color = (*hex2lin(c2), 1)
    nt.links.new(tex.outputs['Fac'], ramp.inputs['Fac'])
    nt.links.new(ramp.outputs['Color'], b.inputs['Base Color'])
    MATS[name] = m
    return m

def brick_mat(name, brick, mortar, scale=4.0, mw=0.01, rough=0.9):
    if name in MATS:
        return MATS[name]
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    nt = m.node_tree
    b = nt.nodes['Principled BSDF']
    b.inputs['Roughness'].default_value = rough
    tex = nt.nodes.new('ShaderNodeTexBrick')
    tex.inputs['Color1'].default_value = (*hex2lin(brick), 1)
    tex.inputs['Color2'].default_value = (*hex2lin(brick), 1)
    tex.inputs['Mortar'].default_value = (*hex2lin(mortar), 1)
    tex.inputs['Scale'].default_value = scale
    tex.inputs['Mortar Size'].default_value = mw
    coord = nt.nodes.new('ShaderNodeTexCoord')
    nt.links.new(coord.outputs['Object'], tex.inputs['Vector'])
    nt.links.new(tex.outputs['Color'], b.inputs['Base Color'])
    MATS[name] = m
    return m

def curtain_mat(name, dark, light, mullion, floors, mullions, rough=0.4):
    """UV-space curtain wall: floor bands x mullion lines (UVs survive the join)"""
    if name in MATS:
        return MATS[name]
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    nt = m.node_tree
    b = nt.nodes['Principled BSDF']
    b.inputs['Roughness'].default_value = rough
    coord = nt.nodes.new('ShaderNodeTexCoord')
    wave_f = nt.nodes.new('ShaderNodeTexWave')
    wave_f.wave_type = 'BANDS'
    wave_f.bands_direction = 'Y'
    wave_f.wave_profile = 'SAW'
    wave_f.inputs['Scale'].default_value = floors
    wave_f.inputs['Distortion'].default_value = 0.0
    ramp_f = nt.nodes.new('ShaderNodeValToRGB')
    ramp_f.color_ramp.interpolation = 'CONSTANT'
    ramp_f.color_ramp.elements[0].color = (*hex2lin(dark), 1)
    ramp_f.color_ramp.elements[1].color = (*hex2lin(light), 1)
    ramp_f.color_ramp.elements[1].position = 0.45
    wave_m = nt.nodes.new('ShaderNodeTexWave')
    wave_m.wave_type = 'BANDS'
    wave_m.bands_direction = 'X'
    wave_m.wave_profile = 'SAW'
    wave_m.inputs['Scale'].default_value = mullions
    wave_m.inputs['Distortion'].default_value = 0.0
    ramp_m = nt.nodes.new('ShaderNodeValToRGB')
    ramp_m.color_ramp.interpolation = 'CONSTANT'
    ramp_m.color_ramp.elements[0].color = (*hex2lin(mullion), 1)
    ramp_m.color_ramp.elements[1].color = (1, 1, 1, 1)
    ramp_m.color_ramp.elements[1].position = 0.12
    mix = nt.nodes.new('ShaderNodeMix')
    mix.data_type = 'RGBA'
    mix.blend_type = 'MULTIPLY'
    mix.inputs['Factor'].default_value = 1.0
    nt.links.new(coord.outputs['UV'], wave_f.inputs['Vector'])
    nt.links.new(coord.outputs['UV'], wave_m.inputs['Vector'])
    nt.links.new(wave_f.outputs['Fac'], ramp_f.inputs['Fac'])
    nt.links.new(wave_m.outputs['Fac'], ramp_m.inputs['Fac'])
    nt.links.new(ramp_f.outputs['Color'], mix.inputs['A'])
    nt.links.new(ramp_m.outputs['Color'], mix.inputs['B'])
    nt.links.new(mix.outputs['Result'], b.inputs['Base Color'])
    MATS[name] = m
    return m

ALL = []

def box(w, h, d, x, y, z, material, rot=0.0, bevel=False, name='b'):
    bpy.ops.mesh.primitive_cube_add(size=1, location=P(x, y, z))
    o = bpy.context.active_object
    o.name = name
    o.scale = (w, d, h)
    if rot:
        o.rotation_euler[2] = rot
    if bevel:
        mod = o.modifiers.new('bev', 'BEVEL')
        mod.width = 0.012
        mod.segments = 2
        mod.angle_limit = math.radians(50)
    o.data.materials.append(material)
    ALL.append(o)
    return o

def cyl(r1, r2, h, x, y, z, material, verts=16, rot=0.0, name='c'):
    bpy.ops.mesh.primitive_cone_add(vertices=verts, radius1=r2, radius2=r1,
                                    depth=h, location=P(x, y, z))
    o = bpy.context.active_object
    o.name = name
    if rot:
        o.rotation_euler[2] = rot
    o.data.materials.append(material)
    ALL.append(o)
    return o

def cone(r, h, x, y, z, material, verts=12, rot=0.0, name='k'):
    bpy.ops.mesh.primitive_cone_add(vertices=verts, radius1=r, radius2=0,
                                    depth=h, location=P(x, y, z))
    o = bpy.context.active_object
    o.name = name
    if rot:
        o.rotation_euler[2] = rot
    o.data.materials.append(material)
    ALL.append(o)
    return o

def sph(r, x, y, z, material, name='s'):
    bpy.ops.mesh.primitive_ico_sphere_add(subdivisions=2, radius=r, location=P(x, y, z))
    o = bpy.context.active_object
    o.name = name
    o.data.materials.append(material)
    ALL.append(o)
    return o

def plane(w, d, x, y, z, material, rot=0.0, name='p'):
    bpy.ops.mesh.primitive_plane_add(size=1, location=P(x, y, z))
    o = bpy.context.active_object
    o.name = name
    o.scale = (w, d, 1)
    if rot:
        o.rotation_euler[2] = rot
    o.data.materials.append(material)
    ALL.append(o)
    return o

def flat_mesh(name, faces_pts, material):
    me = bpy.data.meshes.new(name)
    bm = bmesh.new()
    for pts in faces_pts:
        vs = [bm.verts.new(P(*p)) for p in pts]
        f = bm.faces.new(vs)
        f.normal_update()
        if f.normal.z < 0:
            bmesh.ops.reverse_faces(bm, faces=[f])
    bm.to_mesh(me)
    bm.free()
    ob = bpy.data.objects.new(name, me)
    ob.data.materials.append(material)
    bpy.context.collection.objects.link(ob)
    ALL.append(ob)
    return ob

# angle convention: a=0 points north (-z, away from the river); +a swings east (+x)
def polar_pt(cx, cz, r, a_deg):
    ar = math.radians(a_deg)
    return (cx + r * math.sin(ar), cz - r * math.cos(ar), ar)

def ring_seg(cx, cz, r_in, r_out, a0, a1, y, material, name='ring', segs=None):
    a0r, a1r = math.radians(a0), math.radians(a1)
    if segs is None:
        segs = max(8, int(abs(a1 - a0) / 6))
    faces = []
    for i in range(segs):
        t0 = a0r + (a1r - a0r) * i / segs
        t1 = a0r + (a1r - a0r) * (i + 1) / segs
        faces.append([
            (cx + r_in * math.sin(t0), y, cz - r_in * math.cos(t0)),
            (cx + r_out * math.sin(t0), y, cz - r_out * math.cos(t0)),
            (cx + r_out * math.sin(t1), y, cz - r_out * math.cos(t1)),
            (cx + r_in * math.sin(t1), y, cz - r_in * math.cos(t1)),
        ])
    return flat_mesh(name, faces, material)

def disc_seg(cx, cz, r, a0, a1, y, material, name='disc', segs=24):
    a0r, a1r = math.radians(a0), math.radians(a1)
    faces = []
    for i in range(segs):
        t0 = a0r + (a1r - a0r) * i / segs
        t1 = a0r + (a1r - a0r) * (i + 1) / segs
        faces.append([
            (cx, y, cz),
            (cx + r * math.sin(t0), y, cz - r * math.cos(t0)),
            (cx + r * math.sin(t1), y, cz - r * math.cos(t1)),
        ])
    return flat_mesh(name, faces, material)

# ---------------------------------------------------------------- palette
asphalt = noisy_mat('asphalt', '#47494e', '#52545a', scale=14)
sidewalk = brick_mat('sidewalk', '#cec6b4', '#c6beac', scale=42, mw=0.004)
for n in bpy.data.materials['sidewalk'].node_tree.nodes:
    if n.type == 'TEX_BRICK':
        n.inputs['Mortar'].default_value = (*hex2lin('#b2a996'), 1)
dash = mat('dash', '#d8c06a', rough=0.8)
stripe = mat('stripe', '#cfd2d4', rough=0.8)
parapet = mat('parapet', '#57534c')
hvac = mat('hvac', '#9aa0a4', rough=0.6)
wtankMat = mat('wtank', '#8a6b4f')
wroofMat = mat('wroof', '#5a544c')
poleMat = mat('pole', '#3c4046', rough=0.5)
headMat = mat('lamphead', '#5a4c38', emit='#ffd9a2', emit_strength=4.0)
trunkMat = mat('trunk', '#6b5138')
steel = mat('steel', '#7c8894', rough=0.55)
cableM = mat('cable', '#3c4046', rough=0.5)
winDark = mat('winDark', '#232e38', rough=0.35)
winSky = mat('winSky', '#7d99a8', rough=0.3)
winLit = mat('winLit', '#c98f4a', emit='#ffc37a', emit_strength=2.2)
storefront = mat('storefront', '#33383e', rough=0.6)
plaza = mat('plaza', '#c2bbae')
plazaLight = mat('plazaLight', '#d4cdbd')
plazaDark = mat('plazaDark', '#a89f8e')
grassM = noisy_mat('parkgrass', '#6f9857', '#83aa66', scale=20)
monument = mat('monument', '#e6e2d6')
concrete = noisy_mat('concrete', '#8d8477', '#99907f', scale=0.8, rough=1.0, detail=3.0)

WALL_MATS = {}
for hx in ['#8f8578', '#9aa1a8', '#7d848e', '#a89a8c', '#8a9099', '#b5aa9a',
           '#9c6b52', '#8b94a3', '#bc6e42', '#c9b797', '#6a5f52', '#5f5549',
           '#544b41', '#d9cdb4']:
    WALL_MATS[hx] = noisy_mat('wall' + hx, hx,
                              '#%02x%02x%02x' % tuple(min(255, int(int(hx[i:i+2], 16) * 1.08)) for i in (1, 3, 5)),
                              scale=9, rough=0.92)

ROOFS = [noisy_mat(f'roof{i}', c, c2, scale=12) for i, (c, c2) in enumerate([
    ('#655f58', '#6f6b64'), ('#6f6b64', '#7a766e'), ('#5d5850', '#68635b')])]
AWNINGS = ['#a04432', '#3f5d52', '#54586a', '#8a6b4f', '#7a5a2f']

# ---------------------------------------------------------------- windows
win_geo = {'dark': [], 'sky': [], 'lit': []}

def add_win_quad(cx, cy, cz, rvec, w, h, kind):
    u = (0.0, 1.0, 0.0)
    c = (cx, cy, cz)
    hw, hh = w / 2, h / 2
    quad = []
    for sx, sy in ((-1, -1), (1, -1), (1, 1), (-1, 1)):
        v = (c[0] + rvec[0] * hw * sx + u[0] * hh * sy,
             c[1] + rvec[1] * hw * sx + u[1] * hh * sy,
             c[2] + rvec[2] * hw * sx + u[2] * hh * sy)
        quad.append(P(*v))
    win_geo[kind].append(quad)

def facade_windows(x, z, w, d, h, y0=0.1, rot=0.0):
    span = h - y0 - 0.05
    floors = max(1, int(span / 0.105))
    for face, rloc, nloc in (('f', (1, 0), (0, 1)), ('b', (-1, 0), (0, -1)),
                             ('r', (0, -1), (1, 0)), ('l', (0, 1), (-1, 0))):
        width = w if face in 'fb' else d
        cols = max(1, int(width / 0.095))
        if cols < 2 and floors < 2:
            continue
        rx, rz = rot2(rloc[0], rloc[1], rot)
        nx, nz = rot2(nloc[0], nloc[1], rot)
        off = (w / 2 if face in 'fb' else d / 2) + 0.004
        px, pz = x + nx * off, z + nz * off
        rvec = (rx, 0, rz)
        for fl in range(floors):
            wy = y0 + 0.04 + (fl + 0.5) * (span / floors)
            for cix in range(cols):
                t = (cix + 0.5) / cols - 0.5
                cx = px + rx * t * (width * 0.88)
                cz = pz + rz * t * (width * 0.88)
                r = rnd.random()
                kind = 'lit' if r < 0.12 else ('sky' if r < 0.4 else 'dark')
                add_win_quad(cx, wy, cz, rvec, 0.046, 0.055, kind)

# ---------------------------------------------------------------- ground
box(14.9, 1.96, 14.9, 0, -0.99, 0, concrete, name='slab')
plane(14.9, 14.9, 0, 0.003, 0, sidewalk, name='ground')
# riverfront: water occupies z 5.2..7.45 (City.jsx river shader plane covers it)
plane(14.9, 0.4, 0, 0.010, 5.0, plaza, name='riverwalk')
plane(4.2, 0.5, 0.2, 0.011, 4.55, mat('apron', '#ccc5b6'), name='apron')  # Hart Plaza

# ---------------------------------------------------------------- streets
CM = (0.0, 0.8)   # Campus Martius hub, one block up from the water
GC = (0.0, -2.9)  # Grand Circus terminus

plane(14.9, 0.5, 0, 0.012, 3.95, asphalt, name='aveJeff')   # Jefferson

RADIALS = [  # (a_deg, r0, r1, width)
    (0, 0.95, 8.2, 0.62),     # Woodward N
    (180, 0.95, 3.7, 0.62),   # Woodward S to Jefferson
    (90, 0.95, 7.4, 0.5),     # E (Fort/Lafayette)
    (-90, 0.95, 7.4, 0.5),    # W (Michigan)
    (38, 0.95, 9.6, 0.5),     # NE (Gratiot)
    (-38, 0.95, 9.6, 0.5),    # NW (Grand River)
]
for (a, r0, r1, wdt) in RADIALS:
    x, z, ar = polar_pt(*CM, (r0 + r1) / 2, a)
    plane(wdt, r1 - r0, x, 0.012, z, asphalt, rot=ar, name='aveRad')

ring_seg(*CM, 0.95, 1.30, 0, 360, 0.012, asphalt, 'ringRoad')
ring_seg(*CM, 2.45, 2.80, -104, 104, 0.012, asphalt, 'arc2')
ring_seg(*CM, 4.35, 4.70, 10, 58, 0.012, asphalt, 'arc3a')
ring_seg(*CM, 4.35, 4.70, -58, -10, 0.012, asphalt, 'arc3b')

for (a, r0, r1, wdt) in RADIALS:  # lane dashes
    r = 1.7
    while r < r1 - 0.5:
        x, z, ar = polar_pt(*CM, r, a)
        plane(0.045, 0.34, x, 0.015, z, dash, rot=ar, name='dash')
        r += 0.85
for ad in range(-90, 91, 15):
    x, z, ar = polar_pt(*CM, 2.625, ad)
    plane(0.045, 0.3, x, 0.015, z, dash, rot=ar + math.pi / 2, name='dash')
for i in range(12):
    plane(0.4, 0.05, -6.8 + i * 1.25, 0.015, 3.95, dash, name='dash')

def crosswalk(x, z, ar):
    for i in range(5):
        t = (i - 2) * 0.11
        plane(0.05, 0.4, x + t * math.cos(ar), 0.016, z + t * math.sin(ar),
              stripe, rot=ar, name='xw')
for (a, r0, r1, wdt) in RADIALS:
    for rr in (1.48, 2.28):
        if rr < r1:
            x, z, ar = polar_pt(*CM, rr, a)
            crosswalk(x, z, ar)

# ---------------------------------------------------------------- Campus Martius
disc_seg(*CM, 0.9, 0, 360, 0.014, plazaLight, 'cmPlaza', segs=40)
ring_seg(*CM, 0.32, 0.40, 0, 360, 0.0145, plazaDark, 'cmRing1')
ring_seg(*CM, 0.58, 0.66, 0, 360, 0.0145, plazaDark, 'cmRing2')
for a0 in (40, 130, 220, 310):
    disc_seg(*CM, 0.9, a0, a0 + 45, 0.0148, grassM, 'cmLawn', segs=8)
cone(0.06, 0.46, CM[0], 0.23, CM[1], monument, 8)

# Grand Circus Park — half-circle, dome facing north (away from the river)
disc_seg(*GC, 0.8, -90, 90, 0.0115, grassM, 'gcPark', segs=24)
ring_seg(*GC, 0.55, 0.6, -90, 90, 0.0125, plazaLight, 'gcPath')
ring_seg(*GC, 0.9, 1.12, -96, 96, 0.012, asphalt, 'gcArc')
plane(2.6, 0.34, 0, 0.012, GC[1] + 0.95, asphalt, name='gcAdams')

# ---------------------------------------------------------------- buildings
def building(x, z, w, d, h, wall, rot=0.0, tiered=None):
    wm = WALL_MATS[wall]
    if tiered is None:
        tiered = h >= 0.85 and rnd.random() < 0.45
    h1 = h * 0.68 if tiered else h
    box(w, h1, d, x, h1 / 2, z, wm, rot=rot, bevel=h1 >= 0.5)
    box(w + 0.035, 0.028, d + 0.035, x, h1 + 0.014, z, parapet, rot=rot)
    facade_windows(x, z, w, d, h1, rot=rot)
    roof_y, rw = h1, w
    if tiered:
        tw, td, th = w * 0.62, d * 0.62, h * 0.42
        box(tw, th, td, x, h1 + th / 2, z, wm, rot=rot, bevel=True)
        box(tw + 0.03, 0.024, td + 0.03, x, h1 + th + 0.012, z, parapet, rot=rot)
        facade_windows(x, z, tw, td, h1 + th, y0=h1 + 0.03, rot=rot)
        roof_y, rw = h1 + th, tw
    plane(w * 0.96, d * 0.96, x, h1 + 0.029, z, ROOFS[rnd.randrange(3)], rot=rot, name='roofcap')
    box(w + 0.006, 0.07, d + 0.006, x, 0.035, z, storefront, rot=rot)
    if rnd.random() < 0.6:
        awc = AWNINGS[rnd.randrange(len(AWNINGS))]
        ox, oz = rot2((rnd.random() - 0.5) * w * 0.4, d / 2 + 0.03, rot)
        box(w * 0.34, 0.014, 0.07, x + ox, 0.085, z + oz, mat('awn' + awc, awc), rot=rot)
    if rnd.random() < 0.55:
        ox, oz = rot2((rnd.random() - 0.5) * w * 0.5, (rnd.random() - 0.5) * d * 0.5, rot)
        box(0.11, 0.05, 0.09, x + ox, h1 + 0.025, z + oz, hvac, rot=rot)
    if h >= 1.1 and rnd.random() < 0.55:
        ox, oz = rot2((rnd.random() - 0.5) * rw * 0.4, 0, rot)
        cyl(0.08, 0.08, 0.13, x + ox, roof_y + 0.09, z + oz, wtankMat, 10)
        cone(0.095, 0.08, x + ox, roof_y + 0.19, z + oz, wroofMat, 10)
    if h >= 1.6:
        ox, oz = rot2(rw * 0.22, 0, rot)
        cyl(0.008, 0.008, 0.42, x + ox, roof_y + 0.21, z + oz, poleMat, 5)
        sph(0.018, x + ox, roof_y + 0.43, z + oz, mat('antRed', '#c0392b', emit='#ff4a2e', emit_strength=1.5))

def polar(a_deg, r, w, d, h, wall):
    x, z, ar = polar_pt(*CM, r, a_deg)
    building(x, z, w, d, h, wall, rot=ar)

# financial-district skyline — TALL cluster between Campus Martius and the
# river, layered so the corner camera reads overlapping towers above the
# water. Placements are keyed to the People Mover loop in City.jsx
# (rounded loop through (±2.6, 0..3.1) and (0..±1.6, 3.7..3.85)) — towers sit
# clear of that elevated track.
building(-1.95, 1.5, 0.8, 0.7, 1.9, '#9aa1a8')     # One Woodward-ish
building(-2.1, 2.2, 0.8, 0.7, 1.5, '#8a9099')      # 150 W Jefferson-ish
building(1.6, 1.35, 0.85, 0.7, 1.7, '#8b94a3')     # Ally-ish
building(1.95, 2.95, 0.9, 0.75, 1.35, '#a89a8c')   # Buhl-ish
building(0.55, 2.35, 0.7, 0.6, 1.1, '#b5aa9a')     # Dime-ish
building(-3.6, 2.9, 0.95, 0.8, 1.15, '#7d848e')    # west edge of cluster
building(3.6, 3.0, 0.85, 0.7, 1.05, '#9c6b52')     # east edge

# inner ring around the hub (Woodward-N corridor left open for the Fox)
polar(115, 2.0, 0.9, 0.75, 1.3, '#8b94a3')
polar(-115, 2.0, 0.85, 0.75, 1.2, '#7d848e')

# mid band, north of arc2 (kept clear of Grand Circus and the radials)
polar(26, 4.0, 1.0, 0.8, 0.8, '#a89a8c')
polar(-26, 4.0, 1.0, 0.8, 0.75, '#9aa1a8')
polar(58, 3.6, 0.95, 0.8, 0.65, '#8f8578')
polar(-58, 3.6, 0.95, 0.8, 0.6, '#b5aa9a')
polar(52, 3.7, 0.85, 0.7, 0.55, '#8f8578')
polar(-52, 3.7, 0.85, 0.7, 0.5, '#9c6b52')

# outer low fabric fading north
polar(14, 5.2, 1.0, 0.8, 0.45, '#a89a8c')
polar(-14, 5.2, 1.0, 0.8, 0.4, '#8f8578')
polar(10, 6.4, 1.05, 0.8, 0.38, '#9aa1a8')
polar(-10, 6.4, 1.05, 0.8, 0.35, '#b5aa9a')
polar(26, 5.8, 1.0, 0.8, 0.42, '#9c6b52')
polar(-26, 5.8, 1.0, 0.8, 0.4, '#8f8578')
polar(22, 7.0, 1.0, 0.75, 0.32, '#a89a8c')
polar(-22, 7.0, 1.0, 0.75, 0.3, '#9aa1a8')
polar(30, 6.6, 0.95, 0.75, 0.36, '#8a9099')
polar(52, 5.6, 1.0, 0.8, 0.44, '#9c6b52')
polar(-52, 5.6, 1.0, 0.8, 0.4, '#a89a8c')
polar(60, 6.5, 1.0, 0.8, 0.34, '#8f8578')
polar(-60, 6.5, 1.0, 0.8, 0.32, '#b5aa9a')
polar(72, 5.9, 1.0, 0.8, 0.42, '#8a9099')
polar(-72, 5.9, 1.0, 0.8, 0.38, '#9c6b52')
polar(80, 5.4, 1.2, 0.9, 0.5, '#8a9099')
polar(-80, 5.4, 1.2, 0.9, 0.45, '#a89a8c')
# corner blocks (axis-aligned)
building(-6.5, -6.2, 1.2, 0.9, 0.3, '#8f8578')
building(6.5, -6.3, 1.1, 0.85, 0.28, '#a89a8c')
building(-4.6, -6.9, 1.1, 0.8, 0.26, '#9aa1a8')
building(4.0, -7.0, 1.0, 0.7, 0.25, '#9c6b52')
# surface parking lots — texture variety in the fabric
for (lx, lz, lw, ld, la) in ((4.9, -3.5, 1.0, 0.8, 0.7), (-4.6, -4.4, 1.1, 0.8, -0.6), (5.9, -1.6, 0.9, 0.7, 1.2)):
    plane(lw, ld, lx, 0.0135, lz, plazaDark, rot=la, name='lot')
    for i in range(4):
        plane(0.03, ld * 0.7, lx + (i - 1.5) * lw * 0.22 * math.cos(la), 0.0145,
              lz - (i - 1.5) * lw * 0.22 * math.sin(la), stripe, rot=la, name='lotline')

# east/west riverfront flanks
building(-5.4, 3.0, 1.2, 0.9, 0.85, '#a89a8c')
building(-6.6, 2.4, 1.0, 0.85, 0.6, '#8f8578')
building(-6.3, 4.55, 1.1, 0.45, 0.5, '#8a9099')
building(5.2, 2.8, 1.1, 0.85, 0.9, '#9aa1a8')
building(6.5, 2.2, 0.95, 0.8, 0.55, '#9c6b52')
building(6.3, 4.55, 1.1, 0.45, 0.5, '#b5aa9a')
# riverfront silo cluster east — a little industry on the water
for (sx2, sz2) in ((6.7, 4.45), (6.95, 4.6), (6.75, 4.75)):
    cyl(0.14, 0.14, 0.55, sx2, 0.275, sz2, mat('silo', '#b8b2a4', rough=0.7), 12)
    cone(0.15, 0.1, sx2, 0.6, sz2, wroofMat, 12)

# ---------------------------------------------------------------- streetlights + trees
for (a, rr) in [(20, 1.42), (70, 1.42), (110, 1.42), (160, 1.42),
                (-20, 1.42), (-70, 1.42), (-110, 1.42), (-160, 1.42),
                (14, 2.95), (-14, 2.95), (52, 2.95), (-52, 2.95)]:
    x, z, _ = polar_pt(*CM, rr, a)
    cyl(0.012, 0.016, 0.4, x, 0.2, z, poleMat, 6)
    box(0.1, 0.015, 0.015, x + 0.05, 0.4, z, poleMat)
    sph(0.025, x + 0.1, 0.39, z, headMat)
for x in (-5.9, 0.4):  # riverwalk lights framing the west civic plaza
    cyl(0.012, 0.016, 0.4, x, 0.2, 4.78, poleMat, 6)
    box(0.1, 0.015, 0.015, x + 0.05, 0.4, 4.78, poleMat)
    sph(0.025, x + 0.1, 0.39, 4.78, headMat)

GREENS = [noisy_mat(f'leaf{i}', c, c2, scale=6) for i, (c, c2) in enumerate([
    ('#567e49', '#6a9459'), ('#5f8a52', '#729e62'), ('#4f7644', '#639055')])]

def tree(x, z):
    cyl(0.035, 0.05, 0.2, x, 0.1, z, trunkMat, 6)
    for i in range(3):
        sph(0.13 + rnd.random() * 0.08,
            x + (rnd.random() - 0.5) * 0.14,
            0.3 + i * 0.06 + rnd.random() * 0.04,
            z + (rnd.random() - 0.5) * 0.14,
            GREENS[rnd.randrange(3)], 'leaf')

for a in (45, 135, 225, 315):
    x, z, _ = polar_pt(*CM, 0.5, a)
    tree(x, z)
for ad in (-60, -25, 25, 60):
    x, z, _ = polar_pt(*GC, 0.55, ad)
    tree(x, z)
for z in (-0.9, -1.9, -4.3, -5.3, -6.4):  # Woodward allee north
    tree(0.55, z)
    tree(-0.55, z)
for ad in (-85, -45, 45, 85):
    x, z, _ = polar_pt(*CM, 3.1, ad)
    tree(x, z)
for x in (1.4, 5.5):  # riverwalk east — the civic plaza owns the west stretch
    tree(x, 4.60)

# ---------------------------------------------------------------- landmarks
# Renaissance Center v2 — on the river, right of Hart Plaza
rc_main = curtain_mat('rcMain', '#16282e', '#28464f', '#0f1c20', floors=46, mullions=64, rough=0.35)
rc_sat = curtain_mat('rcSat', '#1b3138', '#2f525b', '#122226', floors=30, mullions=40, rough=0.35)
RC = (3.1, 4.75)
box(2.7, 0.42, 1.15, RC[0], 0.21, RC[1], rc_sat, bevel=True)
box(2.2, 0.24, 0.95, RC[0], 0.54, RC[1], rc_sat)
cyl(0.5, 0.5, 4.5, RC[0], 2.67, RC[1], rc_main, 36)
for ry in (1.9, 3.2):
    cyl(0.507, 0.507, 0.025, RC[0], ry, RC[1], mat('rcBeam', '#9fb2b8', rough=0.4), 36)
cyl(0.507, 0.507, 0.09, RC[0], 4.32, RC[1], mat('gmblue', '#2b5ea7'), 36)
cyl(0.512, 0.512, 0.03, RC[0], 4.62, RC[1], mat('rcCrown', '#c3ccd1', rough=0.35), 36)
cyl(0.46, 0.48, 0.14, RC[0], 4.72, RC[1], mat('rcCap', '#22343a', rough=0.5), 36)
cyl(0.01, 0.01, 0.34, RC[0], 4.95, RC[1], poleMat, 5)
sph(0.02, RC[0], 5.13, RC[1], mat('rcBeacon', '#d8402a', emit='#ff5a3a', emit_strength=2.5))
for (dx, dz) in ((-0.82, -0.34), (0.82, -0.34), (-0.82, 0.34), (0.82, 0.34)):
    cyl(0.3, 0.3, 3.05, RC[0] + dx, 1.945, RC[1] + dz, rc_sat, 8, rot=math.radians(22.5))
    cyl(0.305, 0.305, 0.03, RC[0] + dx, 3.47, RC[1] + dz, MATS['rcCrown'], 8, rot=math.radians(22.5))
for dz in (-0.28, 0.28):
    cyl(0.21, 0.21, 2.0, RC[0] - 1.62, 1.42, RC[1] + dz, rc_sat, 8, rot=math.radians(22.5))

# Penobscot / Guardian / One Detroit Center — the heart of the skyline
PEN = (-1.3, 2.9)
pen = WALL_MATS['#6a5f52']
box(1.3, 2.0, 1.1, PEN[0], 1.0, PEN[1], pen, bevel=True)
facade_windows(PEN[0], PEN[1], 1.3, 1.1, 2.0, y0=0.12)
box(0.95, 0.8, 0.8, PEN[0], 2.4, PEN[1], pen, bevel=True)
facade_windows(PEN[0], PEN[1], 0.95, 0.8, 2.8, y0=2.03)
box(0.62, 0.6, 0.52, PEN[0], 3.1, PEN[1], WALL_MATS['#5f5549'], bevel=True)
box(0.36, 0.45, 0.3, PEN[0], 3.62, PEN[1], WALL_MATS['#544b41'], bevel=True)
cyl(0.02, 0.02, 0.5, PEN[0], 4.1, PEN[1], mat('mast', '#4a423a'), 6)

GUA = (-0.35, 3.35)
box(0.75, 2.5, 0.6, GUA[0], 1.25, GUA[1], WALL_MATS['#bc6e42'], bevel=True)
facade_windows(GUA[0], GUA[1], 0.75, 0.6, 2.5, y0=0.12)
box(0.77, 0.05, 0.62, GUA[0], 2.54, GUA[1], mat('deco1', '#e0c98f'))
box(0.77, 0.04, 0.62, GUA[0], 2.59, GUA[1], mat('deco2', '#3f5d52'))
box(0.56, 0.18, 0.45, GUA[0], 2.7, GUA[1], mat('deco3', '#d8b26a'), bevel=True)

ODC = (0.9, 3.1)
box(0.9, 2.6, 0.72, ODC[0], 1.3, ODC[1], WALL_MATS['#8b94a3'], bevel=True)
facade_windows(ODC[0], ODC[1], 0.9, 0.72, 2.6, y0=0.12)
cone(0.28, 0.5, ODC[0] - 0.22, 2.85, ODC[1], mat('odcSpire', '#77808f', rough=0.5), 4, rot=math.pi / 4)
cone(0.28, 0.5, ODC[0] + 0.22, 2.85, ODC[1], MATS['odcSpire'], 4, rot=math.pi / 4)

# Book Tower — on the Grand River (NW) radial
BK = polar_pt(*CM, 2.95, -38)
bk_rot = BK[2]
box(0.58, 2.3, 0.58, BK[0], 1.15, BK[1], WALL_MATS['#c9b797'], rot=bk_rot, bevel=True)
facade_windows(BK[0], BK[1], 0.58, 0.58, 2.3, y0=0.12, rot=bk_rot)
box(0.64, 0.16, 0.64, BK[0], 2.38, BK[1], mat('copper1', '#5d8a72'), rot=bk_rot)
cone(0.4, 0.22, BK[0], 2.55, BK[1], mat('copper2', '#4f7a63'), 4, rot=bk_rot + math.pi / 4)

# Fox Theatre — Woodward, near Grand Circus
FOX = (-0.85, -1.7)
building(FOX[0], FOX[1], 0.8, 0.9, 0.55, '#bc6e42', rot=0, tiered=False)
box(0.05, 0.4, 0.1, -0.42, 0.62, FOX[1], mat('foxSign', '#c8342c', emit='#ff3b25', emit_strength=1.8))
box(0.16, 0.035, 0.34, -0.38, 0.3, FOX[1], mat('marquee', '#e6ddc4', emit='#ffe9a8', emit_strength=1.3))

# Spirit of Detroit + Dodge Fountain at Hart Plaza
SP = (-0.75, 4.35)
box(0.3, 0.12, 0.2, SP[0], 0.06, SP[1], mat('plinth', '#8a8378'))
spirit = mat('patina', '#3f7561', rough=0.6)
gold = mat('gold', '#d4af5a', rough=0.3, emit='#ffd97a', emit_strength=0.4)
sph(0.1, SP[0], 0.22, SP[1], spirit)
sph(0.055, SP[0], 0.36, SP[1], spirit)
for (sx, rz) in ((-0.14, 0.9), (0.14, -0.9)):
    o = cyl(0.022, 0.022, 0.18, SP[0] + sx, 0.26, SP[1], spirit, 6)
    o.rotation_euler[1] = rz
sph(0.04, SP[0] - 0.2, 0.32, SP[1], gold)
sph(0.035, SP[0] + 0.2, 0.32, SP[1], gold)
cyl(0.22, 0.22, 0.006, 1.3, 0.012, 4.6, mat('basin', '#8fa8b0', rough=0.3), 20)  # east of the civic plaza
for a in (0, 2.1, 4.2):
    cyl(0.012, 0.012, 0.32, 1.3 + 0.14 * math.cos(a), 0.16, 4.6 + 0.14 * math.sin(a), poleMat, 6)
bpy.ops.mesh.primitive_torus_add(major_radius=0.16, minor_radius=0.022,
                                 major_segments=24, minor_segments=8,
                                 location=P(1.3, 0.32, 4.6))
tor = bpy.context.active_object
tor.data.materials.append(mat('fring', '#9aa8ad', rough=0.4))
ALL.append(tor)

# Comerica Park + Ford Field — beyond Grand Circus, northeast
cxx, czz = 2.4, -4.9
o = cyl(0.85, 0.95, 0.32, cxx, 0.16, czz, WALL_MATS['#d9cdb4'], 24)
solid = o.modifiers.new('sol', 'SOLIDIFY')
solid.thickness = 0.05
bpy.context.view_layer.objects.active = o
bpy.ops.object.mode_set(mode='EDIT')
bm = bmesh.from_edit_mesh(o.data)
for f in bm.faces:
    f.select = abs(f.normal.z) > 0.7
bmesh.update_edit_mesh(o.data)
bpy.ops.mesh.delete(type='FACE')
bpy.ops.object.mode_set(mode='OBJECT')
plane(1.44, 1.22, cxx, 0.03, czz, grassM, name='field')
plane(0.4, 0.4, cxx, 0.035, czz - 0.25, noisy_mat('infield', '#b09468', '#a3875c', scale=10), name='infield')
for (dx, dz) in ((-0.7, -0.6), (0.7, -0.6), (-0.7, 0.7), (0.7, 0.7)):
    cyl(0.012, 0.016, 0.6, cxx + dx, 0.3, czz + dz, poleMat, 5)
    box(0.1, 0.05, 0.02, cxx + dx, 0.62, czz + dz, mat('ltbank', '#e6e2d6', emit='#fff3d0', emit_strength=1.0))
box(0.5, 0.2, 0.06, cxx, 0.42, czz + 0.85, mat('sboard', '#2c343c'))
box(0.44, 0.14, 0.01, cxx, 0.42, czz + 0.815, mat('sboardface', '#e07b39', emit='#ff9b4a', emit_strength=0.8))
fx, fz = 4.9, -5.9
box(1.5, 0.44, 1.1, fx, 0.22, fz, WALL_MATS['#9aa1a8'], bevel=True)
box(1.52, 0.06, 1.12, fx, 0.36, fz, mat('fordblue', '#2b5ea7'))
box(1.5, 0.08, 0.78, fx, 0.48, fz, mat('vault1', '#b9c2c9', rough=0.5), bevel=True)
box(1.5, 0.06, 0.44, fx, 0.55, fz, mat('vault2', '#cdd4d9', rough=0.5))
box(1.3, 0.16, 0.01, fx, 0.14, fz - 0.555, winDark)

# ---------------------------------------------------------------- Ambassador Bridge
box(0.55, 0.05, 2.6, -6.35, 0.44, 6.2, steel)
plane(0.4, 2.6, -6.35, 0.47, 6.2, asphalt, name='bridgedeck')
for z in (5.5, 7.1):
    for x in (-6.55, -6.15):
        cyl(0.03, 0.04, 1.45, x, 0.72, z, steel, 8)
    box(0.46, 0.06, 0.07, -6.35, 1.32, z, steel)

def cable(x):
    pts = [P(x, 1.42, 5.5), P(x, 0.66, 6.3), P(x, 1.42, 7.1)]
    cu = bpy.data.curves.new('cable', 'CURVE')
    cu.dimensions = '3D'
    sp = cu.splines.new('NURBS')
    sp.points.add(2)
    for i, p in enumerate(pts):
        sp.points[i].co = (*p, 1)
    sp.use_endpoint_u = True
    sp.order_u = 3
    cu.bevel_depth = 0.012
    cu.bevel_resolution = 3
    ob = bpy.data.objects.new('cable', cu)
    bpy.context.collection.objects.link(ob)
    ob.data.materials.append(cableM)
    bpy.context.view_layer.objects.active = ob
    ob.select_set(True)
    bpy.ops.object.convert(target='MESH')
    ALL.append(bpy.context.active_object)

cable(-6.55)
cable(-6.15)
for z in (5.8, 6.05, 6.55, 6.8):
    sy = 0.66 + 0.76 * ((z - 6.3) / 0.8) ** 2
    for x in (-6.55, -6.15):
        cyl(0.005, 0.005, sy - 0.46, x, (sy + 0.46) / 2, z, cableM, 4)

# ---------------------------------------------------------------- wordless riverfront civic plaza + crowds
# The reference's oversized central copy becomes an open, readable civic space.
# Detroit identity comes from the landmark skyline and this abstract automotive
# wheel / industrial turbine sculpture, so there is deliberately no text mesh.
plazaStone = mat('plazaStone', '#c8c1b4', rough=0.85)
plazaDark = mat('plazaDark', '#69747b', rough=0.65)
plazaSteel = mat('plazaSteel', '#aebbc2', rough=0.28)
plazaCopper = mat('plazaCopper', '#b9653e', rough=0.42)

# Banded pavers and low landscaped islands create a strong isometric rhythm
# without occupying the open middle of the composition.
for i, x in enumerate((-5.35, -4.25, -3.15, -2.05, -0.95, 0.15)):
    box(0.84, 0.012, 0.44, x, 0.012, 4.62, plazaStone, bevel=True, name='plazaPaver')
    box(0.04, 0.014, 0.45, x + 0.44, 0.013, 4.62, plazaDark, name='plazaJoint')

# Wordless automotive wheel sculpture, standing toward the river and acting as
# the civic focal point. It is intentionally offset so Hart Plaza stays open.
SX, SY, SZ = -3.28, 0.47, 4.57
bpy.ops.mesh.primitive_torus_add(
    major_radius=0.30,
    minor_radius=0.047,
    major_segments=48,
    minor_segments=12,
    location=P(SX, SY, SZ),
    rotation=(math.radians(90), 0, 0),
)
wheel = bpy.context.active_object
wheel.name = 'motorCityWheel'
wheel.data.materials.append(plazaSteel)
bev = wheel.modifiers.new('wheelBevel', 'BEVEL')
bev.width = 0.006
bev.segments = 2
ALL.append(wheel)

def beam_between(name, a, b, radius, material, verts=12):
    pa, pb = P(*a), P(*b)
    delta = pb - pa
    bpy.ops.mesh.primitive_cylinder_add(
        vertices=verts,
        radius=radius,
        depth=delta.length,
        location=(pa + pb) * 0.5,
    )
    ob = bpy.context.active_object
    ob.name = name
    ob.rotation_mode = 'QUATERNION'
    ob.rotation_quaternion = delta.to_track_quat('Z', 'Y')
    ob.data.materials.append(material)
    ALL.append(ob)
    return ob

for i in range(10):
    a = math.tau * i / 10
    beam_between(
        'wheelSpoke',
        (SX, SY, SZ),
        (SX + math.cos(a) * 0.255, SY + math.sin(a) * 0.255, SZ),
        0.014,
        plazaCopper,
        10,
    )
beam_between('wheelHub', (SX, SY, SZ - 0.055), (SX, SY, SZ + 0.055), 0.075, plazaCopper, 20)
box(0.74, 0.07, 0.24, SX, 0.06, SZ, plazaDark, bevel=True, name='wheelPlinth')
for x in (SX - 0.24, SX + 0.24):
    beam_between('wheelSupport', (x, 0.09, SZ), (x, 0.27, SZ), 0.025, plazaSteel, 12)

# Seating and planted islands keep the riverwalk active while preserving the
# broad empty center requested for the composition.
for x in (-5.05, -1.60, -0.42):
    box(0.50, 0.055, 0.14, x, 0.075, 4.86, mat('benchWood', '#8d5c3e', rough=0.72), bevel=True, name='plazaBench')
    for dx in (-0.20, 0.20):
        box(0.035, 0.06, 0.10, x + dx, 0.035, 4.86, plazaDark, name='benchLeg')

PPL_MATS = [mat('ppl' + c, c, rough=0.9) for c in
            ['#d95848', '#e59b3a', '#3e79a8', '#48a179', '#7a5aa0',
             '#d96a9b', '#e6dfd0', '#39434f', '#c8b45c', '#b34a2e']]
SKIN_MATS = [mat('pskin' + c, c, rough=0.9) for c in
             ['#e8b48c', '#c98d63', '#9a6b48', '#6b4630']]

def person(x, z):
    cyl(0.016, 0.011, 0.06, x, 0.042, z, PPL_MATS[rnd.randrange(len(PPL_MATS))], 6, name='pplB')
    o = sph(0.0135, x, 0.085, z, SKIN_MATS[rnd.randrange(len(SKIN_MATS))], name='pplH')

def crowd(cx, cz2, n, rx, rz, avoid=()):
    for _ in range(n):
        for _try in range(8):
            x = cx + (rnd.random() * 2 - 1) * rx
            z = cz2 + (rnd.random() * 2 - 1) * rz
            if all((x - ax) ** 2 + (z - az) ** 2 > ar * ar for ax, az, ar in avoid):
                person(x, z)
                break

# Confetti-colored crowds frame the open plaza instead of filling its center.
crowd(-2.6, 4.94, 100, 3.1, 0.045)                    # riverwalk strip in front
crowd(-2.6, 4.34, 115, 3.2, 0.10)                     # Jefferson-side promenade
crowd(-4.45, 4.67, 42, 0.65, 0.16)                    # west sculpture audience
crowd(-1.45, 4.67, 45, 0.72, 0.16)                    # east sculpture audience
crowd(0.2, 4.45, 60, 1.9, 0.18,
      avoid=((-0.75, 4.35, 0.32), (1.3, 4.6, 0.32)))  # Hart Plaza (skip Spirit + fountain)
crowd(5.5, 5.0, 22, 0.8, 0.10)                        # riverwalk east of RenCen
crowd(0.0, 0.8, 70, 0.8, 0.8, avoid=((0.0, 0.8, 0.14),))  # Campus Martius
for side in (-1, 1):                                  # Woodward strollers
    crowd(side * 0.5, -2.0, 30, 0.3, 2.6)
crowd(0.0, -3.25, 30, 0.65, 0.35)                     # Grand Circus lawn
crowd(2.4, -4.9, 14, 0.5, 0.38)                       # Comerica field event
for i in range(9):                                    # Fox Theatre queue
    person(-0.36 + i * 0.055 + (rnd.random() - 0.5) * 0.02,
           -1.62 + (rnd.random() - 0.5) * 0.05)

for (px, pz, pc) in ((-0.2, 4.62, '#d95848'), (0.55, 4.38, '#3e79a8'), (1.35, 4.46, '#e59b3a')):
    cyl(0.005, 0.005, 0.16, px, 0.08, pz, poleMat, 5, name='parasolPole')
    cone(0.085, 0.05, px, 0.175, pz, mat('parasol' + pc, pc, rough=0.8), 8, name='parasol')

FT = (-0.85, 4.56)  # food truck at the plaza's east end, queue toward the water
box(0.34, 0.14, 0.15, FT[0], 0.1, FT[1], mat('truck', '#e8a33d', rough=0.7), name='truckBody')
box(0.3, 0.03, 0.13, FT[0], 0.015, FT[1], storefront, name='truckSkirt')
box(0.18, 0.055, 0.012, FT[0] - 0.02, 0.115, FT[1] + 0.078, storefront, name='truckWin')
box(0.22, 0.012, 0.05, FT[0] - 0.02, 0.18, FT[1] + 0.1, mat('truckAwn', '#c8503c'), name='truckAwn')
for i in range(5):
    person(FT[0] - 0.02 + (rnd.random() - 0.5) * 0.03, FT[1] + 0.14 + i * 0.055)

# ---------------------------------------------------------------- lights + world
sun_data = bpy.data.lights.new('Sun', 'SUN')
sun_data.energy = 5.2
sun_data.color = hex2lin('#ffe6bd')
sun_data.angle = math.radians(3)
sun = bpy.data.objects.new('Sun', sun_data)
bpy.context.collection.objects.link(sun)
d = P(-6, -10, -4) - Vector((0, 0, 0))
sun.rotation_euler = d.normalized().to_track_quat('-Z', 'Y').to_euler()
sun.location = P(6, 10, 4)

world = bpy.data.worlds.get('World') or bpy.data.worlds.new('World')
scene.world = world
world.use_nodes = True
bg = world.node_tree.nodes['Background']
bg.inputs['Color'].default_value = (*hex2lin('#a9bfd3'), 1)
bg.inputs['Strength'].default_value = 0.42

print(f'built {len(ALL)} objects, windows: ' + str({k: len(v) for k, v in win_geo.items()}))

for kind, matref in (('dark', winDark), ('sky', winSky), ('lit', winLit)):
    quads = win_geo[kind]
    if not quads:
        continue
    me = bpy.data.meshes.new('win_' + kind)
    bm = bmesh.new()
    for q in quads:
        vs = [bm.verts.new(v) for v in q]
        bm.faces.new(vs)
    bm.to_mesh(me)
    bm.free()
    ob = bpy.data.objects.new('win_' + kind, me)
    ob.data.materials.append(matref)
    bpy.context.collection.objects.link(ob)
    ALL.append(ob)

print('DONE build')
