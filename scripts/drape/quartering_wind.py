"""Validation and native creation of a finite, anatomical-left surface wind field.

The supplied Venus profile is measured from the preferred no-wind drape at frame 120.
It is an editable force volume, not simulated fluid or automatic face detection.
"""
import math
from pathlib import Path


def finite(value):
    if not isinstance(value, (int, float)) or isinstance(value, bool):
        return False
    try:
        return math.isfinite(value)
    except OverflowError:
        return False


def cross(a, b):
    return (a[1]*b[2]-a[2]*b[1], a[2]*b[0]-a[0]*b[2], a[0]*b[1]-a[1]*b[0])


def validate_profile(profile, config):
    """Reject malformed geometry, reversed panels, right-side support and wrong placement."""
    required = {'vertices', 'triangles', 'reach', 'falloff_power', 'wind_world',
                'geometry_source', 'physical_scope', 'placement'}
    if not isinstance(profile, dict) or set(profile) != required:
        raise ValueError('wind profile has missing or unknown fields')
    vertices, triangles = profile['vertices'], profile['triangles']
    if not isinstance(vertices, list) or not 3 <= len(vertices) <= 10000:
        raise ValueError('wind profile needs 3 to 10000 vertices')
    if any(not isinstance(v, list) or len(v) != 3 or not all(map(finite, v)) for v in vertices):
        raise ValueError('wind vertices must be finite XYZ vectors')
    direction = profile['wind_world']
    if not isinstance(direction, list) or len(direction) != 3 or not all(map(finite, direction)):
        raise ValueError('wind direction must be a finite XYZ vector')
    length = math.sqrt(sum(v*v for v in direction))
    if not .99999 < length < 1.00001 or direction[0] >= 0 or direction[1] <= 0 or abs(direction[2]) > 1e-6:
        raise ValueError('wind direction must be horizontal, unit length, toward -X/+Y')
    if not finite(profile['reach']) or profile['reach'] <= 0:
        raise ValueError('wind reach must be positive and finite')
    if not finite(profile['falloff_power']) or not 0 <= profile['falloff_power'] <= 10:
        raise ValueError('wind falloff power must be between 0 and 10')
    support_min_x = min(v[0] for v in vertices) - profile['reach']
    if support_min_x <= 0:
        raise ValueError('wind direct support must stay wholly on anatomical left (+X)')
    if not isinstance(triangles, list) or not 1 <= len(triangles) <= 20000:
        raise ValueError('wind profile needs 1 to 20000 triangles')
    used = set()
    for tri in triangles:
        if not isinstance(tri, list) or len(tri) != 3 or any(type(i) is not int or not 0 <= i < len(vertices) for i in tri):
            raise ValueError('wind triangle indices are invalid')
        a, b, c = (vertices[i] for i in tri)
        normal = cross([b[i]-a[i] for i in range(3)], [c[i]-a[i] for i in range(3)])
        area2 = math.sqrt(sum(v*v for v in normal))
        if area2 <= 1e-10 or sum(normal[i]*direction[i] for i in range(3))/area2 < .99999:
            raise ValueError('wind triangles must be nondegenerate and face the declared wind direction')
        used.update(tri)
    if len(used) != len(vertices):
        raise ValueError('wind profile has unused vertices')
    placement = profile['placement']
    expected = {'figure_name', 'azimuth_deg', 'scale', 'tilt_deg', 'head_height', 'pose_rows', 'cling_strength', 'cling_reach'}
    if not isinstance(placement, dict) or set(placement) != expected:
        raise ValueError('wind profile placement is incomplete')
    if placement['figure_name'] != Path(config['input']).name:
        raise ValueError('wind profile is calibrated to a different figure; supply a measured --wind-profile')
    for key in expected - {'figure_name'}:
        if placement[key] != config[key]:
            raise ValueError(f'wind profile placement mismatch: {key}; recalibrate the profile')
    return support_min_x


def create_emitter(profile, strength, scene):
    """Native Blender WIND/SURFACE: one nearest-panel field, no collision or face pins."""
    import bpy
    mesh = bpy.data.meshes.new('Finite left-face wind panels')
    mesh.from_pydata(profile['vertices'], [], profile['triangles'])
    mesh.update()
    emitter = bpy.data.objects.new('Wind - anatomical LEFT front quarter', mesh)
    scene.collection.objects.link(emitter)
    emitter.hide_render = True
    emitter.display_type = 'WIRE'
    bpy.context.view_layer.objects.active = emitter
    emitter.select_set(True)
    bpy.ops.object.forcefield_toggle()
    field = emitter.field
    field.type = 'WIND'
    field.shape = 'SURFACE'
    field.flow = 0
    field.noise = 0
    field.falloff_type = 'SPHERE'
    field.falloff_power = profile['falloff_power']
    field.use_max_distance = True
    field.distance_max = profile['reach']
    for frame, value in ((1, 0), (100, 0), (115, strength), (150, strength)):
        field.strength = value
        if not math.isclose(field.strength, value, rel_tol=1e-6, abs_tol=1e-6):
            raise ValueError('Blender clamped the requested wind strength')
        field.keyframe_insert('strength', frame=frame)
    emitter['Scope'] = profile['physical_scope']
    emitter['Calibration'] = profile['geometry_source']
    return emitter
