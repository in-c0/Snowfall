"""Builds /Game/Maps/L_* from SourceArt/Scenes/<level>/scene.json: instance sets, scans, lights, sky, fog, post, markers."""
import json, math, os
import unreal
from sf_common import (PROJECT, SCENES, REPORT_DIR, eal, log, warn, error, step, ensure_dir, load, lin, c3,
                       yaw_three_to_ue, look_rotation, guarded)
import sf_import, sf_materials

LOOK_CALIB = os.path.join(PROJECT, 'Content', 'Data', 'look_calib.json')
# Tunables measured from autoshots (kept in a data file so iterations don't touch code)
DEFAULT_CALIB = {
    'exposure_bias_offset': 0.0,      # added to log2(three exposure)
    'fog_density_per_exp2': 60.0,     # UE FogDensity per unit of three exp2 density (measured: UE fog ~5x weaker than first guess)
    'fog_max_opacity': 1.0,
    'point_scale': 1.0,               # three candela → UE candela
    'dir_scale': 1.0,                 # three directional → UE lux
    'sky_scale': 1.0,
    'hemi_to_sky': 0.3183,            # hemisphere irradiance → equivalent uniform sky radiance (1/π)
    'bloom_scale': 1.0,
    'dof_fstop_at_1': 1.4,
    'grain_scale': 0.6,
    'level_bias': {},                 # per-level exposure offsets fitted against the web renders (tools/calib_exposure.py)
    'skylight_leaking': {'L_Library': 0.35, 'L_Red': 0.1, 'L_Road': 0.15},
    'volumetric_levels': ['L_Red'],    # volumetric fog lights the near fog from scene lights (darker than three's flat fog colour); only for the lamp cone
    'fog_cutoff': 150000.0,           # cm; keeps the sky sphere (r = 2 km) out of the height fog
}

def _srgb(c):
    """linear RGB (0..1+) -> FColor (sRGB). unreal.Color's positional order is not RGBA, so always use keywords."""
    f = lambda v: int(max(0, min(255, round(255 * (max(0.0, min(1.0, float(v))) ** (1 / 2.2))))))
    return unreal.Color(r=f(c[0]), g=f(c[1]), b=f(c[2]), a=255)

def look_calib():
    c = dict(DEFAULT_CALIB)
    if os.path.exists(LOOK_CALIB):
        c.update(json.load(open(LOOK_CALIB)))
    return c

les = unreal.get_editor_subsystem(unreal.LevelEditorSubsystem)
eas = unreal.get_editor_subsystem(unreal.EditorActorSubsystem)

def _spawn(cls, loc=unreal.Vector(0, 0, 0), rot=unreal.Rotator(0, 0, 0), label=None, tags=()):
    a = eas.spawn_actor_from_class(cls, loc, rot)
    if label:
        a.set_actor_label(label)
    if tags:
        a.tags = [unreal.Name(t) for t in tags]
    return a

def _folder(a, f):
    try:
        a.set_folder_path(f)
    except Exception:
        pass

# ---------------------------------------------------------------- materials per scene
def _mat_for(level, mid, m, cache):
    if mid in cache:
        return cache[mid]
    kind = m.get('kind', 'basic')
    folder = f'/Game/Scenes/{level}/Materials'
    name = f'MI_{mid}'
    col = m.get('color', [1, 1, 1])
    snow = float(m.get('snow', 0) or 0)
    sd = m.get('snowDir') or [0, 0, 0]
    sdu = c3(sd)  # direction → UE axes (scale irrelevant, normalised below)
    ln = math.sqrt(sdu.x ** 2 + sdu.y ** 2 + sdu.z ** 2) or 1.0
    snow_dir = (sdu.x / ln * (1 if any(sd) else 0), sdu.y / ln * (1 if any(sd) else 0), sdu.z / ln * (1 if any(sd) else 0), 0)
    tiling = m.get('tiling') or [1, 1]
    sc = {'TileU': tiling[0], 'TileV': tiling[1], 'SnowAmount': snow}
    vec = {'SnowDir': snow_dir}
    tex = {}
    mapt = sf_import.scene_texture(level, m['map']) if m.get('map') else None
    if kind == 'pbr' and m.get('polyhaven'):
        s = sf_import.pbr_set(m['polyhaven'])
        tex = {'BaseTex': s.get('diff'), 'NormalTex': s.get('nor'), 'ARMTex': s.get('arm')}
        vec['Tint'] = (col[0], col[1], col[2], 1)
        sc['RoughMul'] = 1.0 if m.get('roughness') is None else max(0.05, float(m['roughness']))
        parent = '/Game/Materials/M_SF_PBR'
    elif kind == 'snowground' and m.get('art_ground'):
        g = m['art_ground']   # art layer (Content/Data/Art/<level>.json): scanned snow at real scale
        s = sf_import.pbr_set(g['texture'])
        tex = {'BaseTex': s.get('diff'), 'NormalTex': s.get('nor'), 'ARMTex': s.get('arm'), 'DispTex': s.get('disp')}
        sc = {'WorldTile': g.get('world_tile_cm', 260), 'DispScale': min(1.0, g.get('displacement_cm', 5.0) / 8.0), 'Sparkle': g.get('sparkle', 0.15)}
        vec = {'Color': tuple(g.get('tint', [1, 1, 1])) + (1,)}
        parent = '/Game/Materials/M_SF_SnowGround'
    elif kind == 'snowground':
        s = sf_import.pbr_set(m['polyhaven']) if m.get('polyhaven') else {}
        tex = {'NormalTex': s.get('nor'), 'ARMTex': s.get('arm')}
        vec['Color'] = (col[0], col[1], col[2], 1)
        parent = '/Game/Materials/M_SF_Snow'
    elif kind == 'leafcards':
        tex = {'Atlas': mapt}
        sc = {'Grid': m.get('grid', 4), 'Translucency': m.get('translucency', 0.5), 'Wind': m.get('wind', 1.0), 'Roughness': m.get('roughness', 0.7)}
        vec = {'Tint': (col[0], col[1], col[2], 1)}
        parent = '/Game/Materials/M_SF_Leaf'
    elif kind == 'daisy' and not mapt:
        vec['Color'] = (col[0], col[1], col[2], 1)
        sc['Roughness'] = 0.6
        parent = '/Game/Materials/M_SF_Basic2S'
    elif kind == 'daisy':
        tex = {'Atlas': mapt}
        sc = {'Grid': m.get('grid', 1), 'Translucency': m.get('translucency', 0.4), 'Wind': m.get('wind', 1.0), 'Roughness': 0.6}
        vec = {'Tint': (col[0], col[1], col[2], 1)}
        parent = '/Game/Materials/M_SF_Leaf'
    elif kind == 'grass':
        ca = m.get('colorA') or [c * 0.4 for c in col]
        cb = m.get('colorB') or col
        vec = {'ColorA': (ca[0], ca[1], ca[2], 1), 'ColorB': (cb[0], cb[1], cb[2], 1)}
        sc = {'Wind': m.get('wind', 1.0), 'Roughness': m.get('roughness', 0.75)}
        parent = '/Game/Materials/M_SF_Grass'
    elif kind == 'glass':
        vec = {'Color': (col[0], col[1], col[2], 1)}
        sc = {'Opacity': m.get('opacity', 0.2), 'Roughness': m.get('roughness', 0.03)}
        parent = '/Game/Materials/M_SF_Glass'
    elif kind == 'emissive':
        e = m.get('emissive') or col
        vec = {'Color': (e[0], e[1], e[2], 1)}
        sc = {'Intensity': float(m.get('emissiveIntensity', 1))}
        parent = '/Game/Materials/M_SF_Emissive'
    elif m.get('unlit'):
        vec = {'Color': (col[0], col[1], col[2], 1)}
        sc = {'Intensity': 1.0}
        parent = '/Game/Materials/M_SF_Emissive'
    else:
        two = bool(m.get('doubleSided')) or (m.get('alphaTest') or 0) > 0
        parent = '/Game/Materials/M_SF_Basic2S' if two else '/Game/Materials/M_SF_Basic'
        vec['Color'] = (col[0], col[1], col[2], 1)
        e = m.get('emissive') or [0, 0, 0]
        ei = float(m.get('emissiveIntensity', 1) or 0)
        vec['Emissive'] = (e[0] * ei, e[1] * ei, e[2] * ei, 1)
        sc['Roughness'] = m.get('roughness', 0.8) if m.get('roughness') is not None else 0.8
        sc['Metallic'] = m.get('metalness', 0.0) or 0.0
        if m.get('vertexColors'):
            sc['UseVertexColor'] = 1.0
        if mapt:
            tex['BaseTex'] = mapt
    mi = sf_materials.instance(name, parent, folder, scalars=sc, vectors=vec, textures=tex)
    cache[mid] = mi
    return mi

# ---------------------------------------------------------------- environment
def _env(level, scene, cal):
    env = scene.get('env', {}) or {}
    look = scene.get('look', {}) or {}
    lights = scene.get('lights', []) or []
    hemi = [l for l in lights if l.get('type') == 'hemisphere']
    # Sky light
    sky = _spawn(unreal.SkyLight, unreal.Vector(0, 0, 500), label='SkyLight')
    slc = sky.get_component_by_class(unreal.SkyLightComponent)
    slc.set_editor_property('mobility', unreal.ComponentMobility.MOVABLE)
    slc.set_editor_property('real_time_capture', False)
    hdri = sf_import.import_hdri(env['hdri']) if env.get('hdri') else None
    if hdri:
        slc.set_editor_property('source_type', unreal.SkyLightSourceType.SLS_SPECIFIED_CUBEMAP)
        slc.set_editor_property('cubemap', hdri)
        # three adds hemisphere light on top of the env map; fold it in as extra sky intensity (HDRI mean radiance ~1)
        hemi_add = sum(float(h.get('intensity', 1)) * (sum(h.get('sky', [1, 1, 1])) / 3.0) for h in hemi) * cal['hemi_to_sky']
        slc.set_editor_property('intensity', (float(env.get('envIntensity', 1.0)) + hemi_add) * cal['sky_scale'])
    else:
        slc.set_editor_property('source_type', unreal.SkyLightSourceType.SLS_CAPTURED_SCENE)
        inten = sum(float(h.get('intensity', 1)) for h in hemi) * cal['hemi_to_sky'] if hemi else 0.2
        slc.set_editor_property('intensity', max(0.02, inten) * cal['sky_scale'])
        if hemi:
            g = hemi[0].get('ground', [0.1, 0.1, 0.1])
            slc.set_editor_property('lower_hemisphere_color', lin(g))
    if hemi and hdri:
        log(f'{level}: hemisphere light folded into HDRI sky')
    _sky_sphere(level, env, hdri, cal)
    # Background: a large inward sphere with the background/fog colour reads like three's scene.background in fog
    bg = env.get('background')
    fog = env.get('fog')
    # Height fog
    hf = _spawn(unreal.ExponentialHeightFog, unreal.Vector(0, 0, 0), label='HeightFog')
    fc = hf.get_component_by_class(unreal.ExponentialHeightFogComponent)
    if fog:
        fcol = fog.get('color', bg or [0.5, 0.5, 0.5])
        start = 0.0
        if fog.get('type') == 'exp2':
            d = float(fog.get('density', 0.02))
            dens = d * cal['fog_density_per_exp2']
            # exp2 fog is clear up close and thick far away; emulate its onset with a start distance (fit at 50%/90%)
            start = cal.get('fog_start_k', 0.537) / max(d, 1e-4) * 100.0 * float(cal.get('fog_start_scale', {}).get(level, 1.0))
        else:
            near, far = float(fog.get('near', 10)), float(fog.get('far', 100))
            dens = 10.0 * math.log(2) / max(1.0, (near + far) * 0.5)
        fc.set_editor_property('fog_density', dens)
        fc.set_editor_property('fog_height_falloff', 0.02)
        fc.set_editor_property('fog_inscattering_luminance', lin(fcol))
        fc.set_editor_property('fog_max_opacity', cal['fog_max_opacity'])
        fc.set_editor_property('start_distance', start)
        try:
            fc.set_editor_property('fog_cutoff_distance', cal['fog_cutoff'] if (env.get('sky') or {}).get('kind') == 'dome' else 0.0)
        except Exception as e:
            warn(f'fog cutoff: {e}')
    else:
        fc.set_editor_property('fog_density', 0.002)
    if level in cal['volumetric_levels']:
        for prop in ('enable_volumetric_fog', 'volumetric_fog', 'b_enable_volumetric_fog'):
            try:
                fc.set_editor_property(prop, True); break
            except Exception:
                continue
        fc.set_editor_property('volumetric_fog_scattering_distribution', 0.6)
        fc.set_editor_property('volumetric_fog_extinction_scale', 1.0)
        fc.set_editor_property('volumetric_fog_albedo', unreal.Color(r=235, g=238, b=245, a=255))
    # Post process
    ppv = _spawn(unreal.PostProcessVolume, label='PostProcess')
    ppv.set_editor_property('unbound', True)
    ppv.set_editor_property('priority', 0.0)
    s = ppv.get_editor_property('settings')
    def ov(prop, val):
        try:
            s.set_editor_property('override_' + prop, True)
            s.set_editor_property(prop, val)
        except Exception as e:
            warn(f'pp {prop}: {e}')
    ov('auto_exposure_method', unreal.AutoExposureMethod.AEM_MANUAL)
    ov('auto_exposure_apply_physical_camera_exposure', False)
    e3 = float(look.get('exposure', 1.0) or 1.0)
    ov('auto_exposure_bias', math.log2(max(e3, 1e-3)) + cal['exposure_bias_offset'] + float(cal.get('level_bias', {}).get(level, 0.0)))
    leak = cal.get('skylight_leaking', {}).get(level)
    if leak:
        ov('lumen_skylight_leaking', float(leak))
    ov('bloom_intensity', float(look.get('bloom', 0.3)) * 2.0 * cal['bloom_scale'])
    ov('bloom_threshold', -1.0)
    ov('vignette_intensity', float(look.get('vignette', 0.4)))
    ov('film_grain_intensity', float(look.get('grain', 0.04)) * cal['grain_scale'] * 10)
    ov('scene_fringe_intensity', float(look.get('ca', 0.0)) * 0.3)
    sat = float(look.get('sat', 1.0)); con = float(look.get('contrast', 1.0))
    ov('color_saturation', unreal.Vector4(1, 1, 1, sat))
    ov('color_contrast', unreal.Vector4(1, 1, 1, con))
    if look.get('gamma'):
        g = look['gamma']; ov('color_gamma', unreal.Vector4(g[0], g[1], g[2], 1))
    if look.get('gain'):
        g = look['gain']; ov('color_gain', unreal.Vector4(g[0], g[1], g[2], 1))
    if look.get('lift'):
        l = look['lift']; ov('color_offset', unreal.Vector4(l[0], l[1], l[2], 0))
    if look.get('tint'):
        t = look['tint']; ov('scene_color_tint', unreal.LinearColor(t[0], t[1], t[2], 1))
    if look.get('dof') and look.get('focus'):
        ov('depth_of_field_focal_distance', float(look['focus']) * 100.0)
        ov('depth_of_field_fstop', cal['dof_fstop_at_1'] / max(0.1, float(look['dof'])))
        ov('depth_of_field_sensor_width', 36.0)
    ov('motion_blur_amount', 0.35)
    ov('lumen_final_gather_quality', 2.0)
    ov('lumen_scene_lighting_quality', 2.0)
    ov('lumen_reflection_quality', 2.0)
    ov('lumen_scene_detail', 2.0)
    ppv.set_editor_property('settings', s)
    # Warp material for transitions (driven by directors through a blendable weight)
    warp = load('/Game/Materials/PP/M_PP_Warp')
    if warp:
        try:
            s = ppv.get_editor_property('settings')
            wb = s.get_editor_property('weighted_blendables')
            arr = list(wb.get_editor_property('array'))
            arr.append(unreal.WeightedBlendable(weight=1.0, object=warp))
            wb.set_editor_property('array', arr)
            s.set_editor_property('weighted_blendables', wb)
            ppv.set_editor_property('settings', s)
        except Exception as e:
            warn(f'blendable: {e}')
    for a in (sky, hf, ppv):
        _folder(a, 'Env')

def _sky_sphere(level, env, hdri, cal):
    """three's scene.background / sky dome as a huge unlit sphere: dome gradient, HDRI, or flat colour."""
    sph = load('/Engine/BasicShapes/Sphere')
    if not sph:
        return
    sky = env.get('sky') or {}
    kind = sky.get('kind') or ('hdri' if hdri else 'color')
    folder = f'/Game/Scenes/{level}/Materials'
    if kind == 'dome':
        u = sky.get('uniforms', {})
        top = u.get('uZen') or u.get('uTop') or sky.get('top') or [0.1, 0.2, 0.5]
        hor = u.get('uHor') or u.get('uHaze') or sky.get('horizon') or [0.8, 0.8, 0.8]
        mid = u.get('uMid') or [(a + b) / 2 for a, b in zip(top, hor)]
        sun = c3(u.get('uSun') or [0.3, 0.6, 0.7]); ln = math.sqrt(sun.x ** 2 + sun.y ** 2 + sun.z ** 2) or 1
        glow = u.get('uGlow') or [1.0, 0.92, 0.8]
        mi = sf_materials.instance(f'MI_SkyDome', '/Game/Materials/M_SkyDome', folder,
                                   scalars={'Intensity': 1.0},
                                   vectors={'Top': (*top, 1), 'Mid': (*mid, 1), 'Hor': (*hor, 1), 'SunDir': (sun.x / ln, sun.y / ln, sun.z / ln, 0), 'Glow': (*glow, 1)})
    elif kind == 'hdri' and hdri:
        mi = sf_materials.instance(f'MI_Sky_{env["hdri"]}', '/Game/Materials/M_SkyHDRI', folder,
                                   scalars={'Intensity': float(env.get('envIntensity', 1.0)) * cal['sky_scale']}, textures={'Cube': hdri})
    else:
        bg = env.get('background') or sky.get('top') or [0, 0, 0]
        mi = sf_materials.instance('MI_SkyColor', '/Game/Materials/M_SF_Emissive', folder, scalars={'Intensity': 1.0}, vectors={'Color': (*bg, 1)})
    bd = _spawn(unreal.StaticMeshActor, unreal.Vector(0, 0, 0), label='Sky', tags=['Sky'])
    smc = bd.static_mesh_component
    smc.set_static_mesh(sph)
    bd.set_actor_scale3d(unreal.Vector(4000, 4000, 4000))
    smc.set_editor_property('cast_shadow', False)
    # the 2 km sphere must not collide: with BasicShapes' simple sphere collision the player spawns *on top of the sky*
    # (found by the L_Blizzard walk capture: player at Z = +2000 m)
    smc.set_collision_profile_name('NoCollision')
    smc.set_collision_enabled(unreal.CollisionEnabled.NO_COLLISION)
    smc.set_editor_property('can_character_step_up_on', unreal.CanBeCharacterBase.ECB_NO)
    smc.set_editor_property('generate_overlap_events', False)
    bd.set_actor_enable_collision(False)
    smc.set_material(0, mi)
    for prop in ('visible_in_ray_tracing', 'affect_distance_field_lighting', 'affect_dynamic_indirect_lighting'):
        try:
            smc.set_editor_property(prop, False)
        except Exception:
            pass
    _folder(bd, 'Env')

def _light(l, cal, i):
    t = l.get('type')
    col = lin(l.get('color', [1, 1, 1]))
    pos = c3(l.get('position', [0, 0, 0]))
    tags = [l['tag']] if l.get('tag') else []
    if t == 'directional':
        tgt = l.get('target', [0, 0, 0])
        rot = look_rotation(l['position'], tgt)
        a = _spawn(unreal.DirectionalLight, pos, rot, f'Sun_{i}', tags)
        c = a.get_component_by_class(unreal.DirectionalLightComponent)
        c.set_editor_property('intensity', float(l.get('intensity', 1)) * cal['dir_scale'])
        c.set_editor_property('cast_shadows', bool(l.get('castShadow', True)))
        c.set_editor_property('atmosphere_sun_light', False)
        try:
            c.set_editor_property('light_source_angle', float(l.get('source_angle', 1.0)))
        except Exception:
            pass
    elif t in ('point', 'spot'):
        cls = unreal.SpotLight if t == 'spot' else unreal.PointLight
        rot = look_rotation(l['position'], l['target']) if (t == 'spot' and l.get('target')) else unreal.Rotator(-90, 0, 0)
        a = _spawn(cls, pos, rot, f'{t.title()}_{i}', tags)
        c = a.get_component_by_class(unreal.SpotLightComponent if t == 'spot' else unreal.PointLightComponent)
        c.set_editor_property('intensity_units', unreal.LightUnits.CANDELAS)
        c.set_editor_property('intensity', float(l.get('intensity', 1)) * cal['point_scale'])
        dist = float(l.get('distance', 0) or 0)
        c.set_editor_property('attenuation_radius', dist * 100.0 if dist > 0 else 3000.0)
        c.set_editor_property('cast_shadows', bool(l.get('castShadow', False)))
        c.set_editor_property('source_radius', float(l.get('radius', 0.05)) * 100.0)
        c.set_editor_property('soft_source_radius', 10.0)
        if t == 'spot':
            ang = math.degrees(float(l.get('angle', 0.5)))
            pen = float(l.get('penumbra', 0.3))
            c.set_editor_property('outer_cone_angle', ang)
            c.set_editor_property('inner_cone_angle', ang * (1.0 - pen))
    else:
        return None
    try:
        c.set_editor_property('light_color', _srgb(l.get('color', [1, 1, 1])))
        c.set_editor_property('mobility', unreal.ComponentMobility.MOVABLE)
        c.set_editor_property('volumetric_scattering_intensity', float(l.get('volumetric', 1.0)))
    except Exception as e:
        warn(f'light {i}: {e}')
    _folder(a, 'Lights')
    return a

def _marker(mk):
    tag = mk.get('tag', 'Marker')
    pos = c3(mk.get('position', [0, 0, 0]))
    if mk.get('lookAt'):
        rot = look_rotation(mk['position'], mk['lookAt'])
    elif mk.get('yaw') is not None:
        rot = unreal.Rotator(roll=0, pitch=math.degrees(float(mk.get('pitch', 0))), yaw=yaw_three_to_ue(float(mk['yaw'])))
    else:
        rot = unreal.Rotator(0, 0, 0)
    if tag == 'PlayerStart':
        # PlayerStart location is the capsule centre; three markers are at the feet/eye? (exporter writes feet position)
        a = _spawn(unreal.PlayerStart, unreal.Vector(pos.x, pos.y, pos.z + 96.0), unreal.Rotator(0, 0, rot.yaw), f'Start_{mk.get("spawn", "default")}')
        a.set_editor_property('player_start_tag', unreal.Name(mk.get('spawn') or 'default'))
        a.tags = [unreal.Name(mk.get('spawn') or 'default')]
    elif tag == 'Shot' or tag.endswith('Cam') or mk.get('fov'):
        a = _spawn(unreal.CameraActor, pos, rot, mk.get('name') or tag, [tag] + ([mk['name']] if mk.get('name') else []))
        cc = a.get_component_by_class(unreal.CameraComponent)
        cc.set_editor_property('field_of_view', float(mk.get('fov', 62)) * 1.25)   # three vertical FOV → UE horizontal (16:9 approx)
        cc.set_editor_property('constrain_aspect_ratio', False)
    elif tag == 'Glow':
        a = _spawn(unreal.PointLight, pos, rot, 'Glow', ['Glow'])
        c = a.get_component_by_class(unreal.PointLightComponent)
        c.set_editor_property('intensity_units', unreal.LightUnits.CANDELAS)
        c.set_editor_property('intensity', float(mk.get('intensity', 0.6)))
        c.set_editor_property('attenuation_radius', float(mk.get('size', 1.0)) * 400.0)
        c.set_editor_property('cast_shadows', False)
        col = mk.get('color', [1, 0.8, 0.5])
        c.set_editor_property('light_color', _srgb(col))
        c.set_editor_property('mobility', unreal.ComponentMobility.MOVABLE)
    else:
        a = _spawn(unreal.TargetPoint, pos, rot, tag, [tag])
    _folder(a, 'Markers')
    return a

def _merge_colors(level, m, d):
    import struct
    raw = open(os.path.join(d, m['instances']), 'rb').read()
    col = open(os.path.join(d, m['instanceColors']), 'rb').read()
    n = len(raw) // 64
    out = bytearray()
    for i in range(n):
        out += raw[i * 64:(i + 1) * 64] + struct.pack('<f', 0.0) + col[i * 12:(i + 1) * 12]
    p = os.path.join(REPORT_DIR, 'inst', f'{level}_{m["id"]}.bin')
    os.makedirs(os.path.dirname(p), exist_ok=True)
    open(p, 'wb').write(bytes(out))
    return p

# ---------------------------------------------------------------- level
@guarded
def build_level(level, scene, calib):
    cal = look_calib()
    path = f'/Game/Maps/{level}'
    ensure_dir('/Game/Maps')
    # Rebuild in place: deleting a map that is (or was) loaded fails silently, and new_level() on an existing
    # path keeps editing the previous world. So load it and clear it instead.
    if eal.does_asset_exist(path):
        if not les.load_level(path):
            error(f'{level}: could not load existing map'); return False
        n = 0
        for a in eas.get_all_level_actors():
            if isinstance(a, (unreal.WorldSettings,)) or a.get_class().get_name() in ('WorldSettings', 'Brush', 'DefaultPhysicsVolume'):
                continue
            if eas.destroy_actor(a):
                n += 1
        log(f'{level}: cleared {n} actors')
    else:
        if not les.new_level(path):
            error(f'{level}: new_level failed'); return False
    cur = unreal.get_editor_subsystem(unreal.UnrealEditorSubsystem).get_editor_world().get_path_name()
    if level not in cur:
        error(f'{level}: editing the wrong world ({cur})'); return False
    d = os.path.join(SCENES, level)
    gx, gy, gz = (unreal.Vector(*calib[k]) for k in ('GX', 'GY', 'GZ'))
    mats = scene.get('materials', {})
    cache = {}
    n_inst = 0
    for m in scene.get('meshes', []):
        if 'contactShadow' in (m.get('name') or ''):
            continue   # fake contact shadows are replaced by real shadows + Lumen AO
        sm = load(f'/Game/Scenes/{level}/Meshes/SM_{m["id"]}')
        if sm is None:
            continue
        md = mats.get(m.get('material'), {})
        mi = _mat_for(level, m.get('material'), md, cache) if m.get('material') else None
        a = _spawn(unreal.SFInstanceSet, label=(m.get('name') or m['id'])[:60], tags=[m['tag']] if m.get('tag') else [])
        if m.get('instances'):
            ipath, cf = os.path.join(d, m['instances']), int(m.get('customFloats', 0))
            if m.get('instanceColors') and cf == 0:
                ipath, cf = _merge_colors(level, m, d), 4
            n_inst += a.load_from_file(ipath, cf, sm, mi, gx, gy, gz)
        else:
            a.set_single([float(v) for v in m['matrix']], sm, mi, gx, gy, gz); n_inst += 1
        kind = md.get('kind', 'basic')
        foliage = kind in sf_import.FOLIAGE_KINDS
        a.configure(bool(m.get('castShadow', True)), not foliage and kind != 'glass', 0.0, True)
        if m.get('hidden'):
            a.set_actor_hidden_in_game(True)
        _folder(a, 'Geometry/Foliage' if foliage else 'Geometry')
    for mo in scene.get('models', []):
        sm = sf_import.import_model(mo['name'], mo.get('node'))
        if sm is None:
            continue
        a = _spawn(unreal.SFInstanceSet, label=mo['name'], tags=[mo['tag']] if mo.get('tag') else [])
        a.set_single([float(v) for v in mo['matrix']], sm, None, gx, gy, gz)
        a.configure(bool(mo.get('castShadow', True)), True, 0.0, True)
        if mo.get('snow'):
            comp = a.get_component_by_class(unreal.HierarchicalInstancedStaticMeshComponent)
            for i in range(sm.get_num_sections(0) if hasattr(sm, 'get_num_sections') else 1):
                base = comp.get_material(i)
                if base and base.get_path_name().startswith(f'/Game/Models/{mo["name"]}'):
                    sd = mo.get('snowDir') or [0, 0, 0]
                    v = c3(sd); ln = math.sqrt(v.x * v.x + v.y * v.y + v.z * v.z) or 1
                    mi = sf_materials.instance(f'MI_{mo["name"]}_{i}_snow', base.get_path_name().split('.')[0], f'/Game/Scenes/{level}/Materials',
                                               scalars={'SnowAmount': float(mo['snow'])}, vectors={'SnowDir': (v.x / ln, v.y / ln, v.z / ln, 0) if any(sd) else (0, 0, 0, 0)})
                    comp.set_material(i, mi)
        _folder(a, 'Models')
    for i, l in enumerate(scene.get('lights', [])):
        _light(l, cal, i)
    _env(level, scene, cal)
    for mk in scene.get('markers', []):
        _marker(mk)
    if not any(mk.get('tag') == 'PlayerStart' for mk in scene.get('markers', [])):
        warn(f'{level}: no PlayerStart marker; adding one at origin')
        _spawn(unreal.PlayerStart, unreal.Vector(0, 0, 100), unreal.Rotator(0, 0, 0), 'Start_default')
    try:
        dump = []
        for a in eas.get_all_level_actors():
            o, e = a.get_actor_bounds(False)
            dump.append({'label': a.get_actor_label(), 'class': a.get_class().get_name(), 'tags': [str(t) for t in a.tags],
                         'center': [round(o.x), round(o.y), round(o.z)], 'extent': [round(e.x), round(e.y), round(e.z)]})
        json.dump(dump, open(os.path.join(REPORT_DIR, f'{level}_actors.json'), 'w'), indent=0)
    except Exception as e:
        warn(f'actor dump: {e}')
    try:
        import sf_art
        sf_art.apply(level, scene, calib)   # versioned art layer (Content/Data/Art/<level>.json) on top of the export
    except Exception as e:
        import traceback
        error(f'{level}: art layer failed: {e}\n{traceback.format_exc()}')
    les.save_current_level()
    step(f'level {level}', meshes=len(scene.get('meshes', [])), instances=n_inst, lights=len(scene.get('lights', [])), markers=len(scene.get('markers', [])))
    return True
