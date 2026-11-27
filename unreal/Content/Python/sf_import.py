"""Imports everything the levels need: calibration, scene meshes & textures, Poly Haven scans, HDRIs, characters, audio, authored meshes."""
import glob, json, math, os, re
import unreal
from sf_common import (PROJECT, SOURCE, DOWNLOADS, SCENES, REPORT_DIR, asset_tools, eal, log, warn, error, step,
                       ensure_dir, load, import_file, guarded)

CALIB_FILE = os.path.join(REPORT_DIR, 'calibration.json')

# ---------------------------------------------------------------- helpers
def _assets_in(folder, cls=None, recursive=True):
    out = []
    for p in eal.list_assets(folder, recursive=recursive, include_folder=False):
        a = eal.load_asset(p)
        if a is not None and (cls is None or isinstance(a, cls)):
            out.append(a)
    return out

def _rename(asset, folder, name):
    want = f'{folder}/{name}'
    cur = asset.get_path_name().split('.')[0]
    if cur == want:
        return asset
    if eal.does_asset_exist(want):
        eal.delete_asset(want)
    if not eal.rename_asset(cur, want):
        warn(f'rename failed {cur} -> {want}')
        return asset
    return eal.load_asset(want)

def _import_gltf(path, folder):
    """glTF/glb through Interchange (default pipeline). Returns loaded assets created under folder."""
    ensure_dir(folder)
    paths = import_file(path, folder)
    if not paths:
        # Interchange sometimes reports nothing even though assets were created; scan the folder
        return _assets_in(folder)
    return [a for a in (eal.load_asset(p.split('.')[0]) for p in paths) if a is not None]

def _static_mesh(assets):
    for a in assets:
        if isinstance(a, unreal.StaticMesh):
            return a
    return None

def _tri_count(sm):
    try:
        return sm.get_num_triangles(0)
    except Exception:
        return 0

def _set_nanite(sm, on):
    """Through StaticMeshEditorSubsystem so the mesh is rebuilt: setting the property alone left the first piece of
    every pine (850k triangles) without Nanite data, rendered 350 times on the classic path (60 ms/frame, tag gp1)."""
    try:
        ns = sm.get_editor_property('nanite_settings')
        if ns.get_editor_property('enabled') != on:
            ns.set_editor_property('enabled', on)
            try:
                unreal.get_editor_subsystem(unreal.StaticMeshEditorSubsystem).set_nanite_settings(sm, ns, True)
            except Exception:
                sm.set_editor_property('nanite_settings', ns)
    except Exception as e:
        warn(f'nanite {sm.get_name()}: {e}')

def _set_collision(sm, complex_as_simple):
    try:
        bs = sm.get_editor_property('body_setup')
        if bs is None:
            return
        bs.set_editor_property('collision_trace_flag', unreal.CollisionTraceFlag.CTF_USE_COMPLEX_AS_SIMPLE if complex_as_simple else unreal.CollisionTraceFlag.CTF_USE_DEFAULT)
    except Exception as e:
        warn(f'collision {sm.get_name()}: {e}')

def _no_collision(sm):
    try:
        bs = sm.get_editor_property('body_setup')
        if bs:
            bs.set_editor_property('collision_trace_flag', unreal.CollisionTraceFlag.CTF_USE_SIMPLE_AS_COMPLEX)
        unreal.EditorStaticMeshLibrary.remove_collisions(sm)
    except Exception as e:
        warn(f'nocollision {sm.get_name()}: {e}')

def _texture(path, folder, name, kind='color'):
    """kind: color | normal | masks | hdr"""
    ensure_dir(folder)
    full = f'{folder}/{name}'
    t = load(full)
    if t is None:
        got = import_file(path, folder, name)
        t = load(full) or (eal.load_asset(got[0].split('.')[0]) if got else None)
    if t is None:
        warn(f'texture import failed {path}')
        return None
    try:
        if kind == 'normal':
            t.set_editor_property('compression_settings', unreal.TextureCompressionSettings.TC_NORMALMAP)
            t.set_editor_property('srgb', False)
            t.set_editor_property('flip_green_channel', True)   # Poly Haven nor_gl → DirectX convention
        elif kind == 'masks':
            t.set_editor_property('compression_settings', unreal.TextureCompressionSettings.TC_MASKS)
            t.set_editor_property('srgb', False)
        eal.save_loaded_asset(t)
    except Exception as e:
        warn(f'texture settings {name}: {e}')
    return t

# ---------------------------------------------------------------- calibration
@guarded
def calibrate():
    """Import the calibration box exported from three.js and measure how the glTF importer maps three-local axes.
    Box local min (1,3,6) max (2,5,9): sizes (1,2,3), centres (1.5,4,7.5) along three X,Y,Z."""
    src = os.path.join(SCENES, 'L_Blizzard', 'calib.glb')
    fallback = {'GX': [0, 100, 0], 'GY': [0, 0, 100], 'GZ': [-100, 0, 0], 'measured': False}
    if not os.path.exists(src):
        warn('calib.glb missing; assuming the natural mapping (−z,x,y)·100')
        json.dump(fallback, open(CALIB_FILE, 'w'))
        return fallback
    assets = _import_gltf(src, '/Game/_Calib')
    sm = _static_mesh(assets)
    if sm is None:
        warn('calibration mesh not imported; using fallback')
        json.dump(fallback, open(CALIB_FILE, 'w'))
        return fallback
    box = sm.get_bounding_box()
    mn, mx = box.min, box.max
    ue_min = [mn.x, mn.y, mn.z]; ue_max = [mx.x, mx.y, mx.z]
    sizes3 = [1.0, 2.0, 3.0]; centers3 = [1.5, 4.0, 7.5]
    G = [None, None, None]
    for a in range(3):
        ext = ue_max[a] - ue_min[a]; cen = (ue_max[a] + ue_min[a]) / 2
        # which three axis has this relative size?
        ratios = [ext / s for s in sizes3]
        best = None
        for k in range(3):
            sc = abs(cen) / centers3[k]
            if abs(ratios[k] - sc) / max(sc, 1e-6) < 0.05:
                best = k
        if best is None:
            best = min(range(3), key=lambda k: abs(ratios[k] - sorted(ratios)[1]))
        scale = ext / sizes3[best]
        sign = 1.0 if cen >= 0 else -1.0
        v = [0.0, 0.0, 0.0]; v[a] = sign * scale
        G[best] = v
    if any(g is None for g in G):
        warn(f'calibration ambiguous (min {ue_min} max {ue_max}); fallback')
        res = fallback
    else:
        res = {'GX': G[0], 'GY': G[1], 'GZ': G[2], 'measured': True, 'ue_min': ue_min, 'ue_max': ue_max}
    json.dump(res, open(CALIB_FILE, 'w'), indent=1)
    step('calibration', **res)
    eal.delete_directory('/Game/_Calib')
    return res

def calibration():
    if os.path.exists(CALIB_FILE):
        return json.load(open(CALIB_FILE))
    return calibrate()

# ---------------------------------------------------------------- scene meshes
FOLIAGE_KINDS = ('leafcards', 'grass', 'daisy')

@guarded
def import_scene(level):
    d = os.path.join(SCENES, level)
    sj = os.path.join(d, 'scene.json')
    if not os.path.exists(sj):
        warn(f'no scene for {level}')
        return None
    scene = json.load(open(sj, encoding='utf-8'))
    base = f'/Game/Scenes/{level}'
    mats = scene.get('materials', {})
    n_new = 0
    for m in scene.get('meshes', []):
        folder = f'{base}/Meshes'
        name = f'SM_{m["id"]}'
        if load(f'{folder}/{name}'):
            continue
        tmp = f'{base}/_tmp_{m["id"]}'
        assets = _import_gltf(os.path.join(d, m['file']), tmp)
        sm = _static_mesh(assets)
        if sm is None:
            warn(f'{level}: mesh {m["id"]} ({m.get("name")}) did not import'); eal.delete_directory(tmp); continue
        ensure_dir(folder)
        sm = _rename(sm, folder, name)
        eal.delete_directory(tmp)   # drop the importer's auto materials/textures
        kind = mats.get(m.get('material'), {}).get('kind', 'basic')
        tris = _tri_count(sm)
        if kind in FOLIAGE_KINDS or kind == 'glass':
            _no_collision(sm)
            _set_nanite(sm, kind in ('leafcards', 'daisy') and tris > 20000)
        else:
            _set_collision(sm, True)
            _set_nanite(sm, tris > 4000 and kind not in ('emissive',))
        eal.save_loaded_asset(sm)
        n_new += 1
    for png in glob.glob(os.path.join(d, 'tex', '*.png')):
        n = os.path.splitext(os.path.basename(png))[0]
        _texture(png, f'{base}/Tex', 'T_' + re.sub(r'[^A-Za-z0-9_]', '_', n))
    step(f'scene {level}', meshes=len(scene.get('meshes', [])), new=n_new)
    return scene

def scene_texture(level, rel):
    n = os.path.splitext(os.path.basename(rel))[0]
    return load(f'/Game/Scenes/{level}/Tex/T_' + re.sub(r'[^A-Za-z0-9_]', '_', n))

# ---------------------------------------------------------------- Poly Haven
@guarded
def import_pbr_set(name):
    folder = f'/Game/Textures/{name}'
    src = os.path.join(DOWNLOADS, 'textures', name)
    out = {}
    for short, kind in (('diff', 'color'), ('nor', 'normal'), ('arm', 'masks'), ('disp', 'masks')):
        f = (glob.glob(os.path.join(src, f'{name}_{short}.*')) or [None])[0]
        if f:
            out[short] = _texture(f, folder, f'T_{name}_{short}', kind)
    return out

def pbr_set(name):
    folder = f'/Game/Textures/{name}'
    got = {s: load(f'{folder}/T_{name}_{s}') for s in ('diff', 'nor', 'arm', 'disp')}
    if not got['diff']:
        got = import_pbr_set(name) or {}
    return got

FOLIAGE_SLOT = ('twig', 'needle', 'leaf', 'leaves', 'foliage')

@guarded
def import_model(name, node=None, collide=True):
    """node: use only that mesh of a multi-object scan sheet (asset /Game/Models/<name>/<node>).
    Poly Haven glTF → /Game/Models/<name>/<name> (+ its textures and one M_SF_PBR instance per slot, so snow can settle on it)."""
    folder = f'/Game/Models/{name}'
    want = re.sub(r'[^A-Za-z0-9_]', '_', node or name)   # asset names cannot contain '.'
    if load(f'{folder}/{want}'):
        return load(f'{folder}/{want}')
    src0 = os.path.join(DOWNLOADS, 'models', name, name + '.gltf')
    if not os.path.exists(src0):
        warn(f'model {name} not downloaded'); return None
    # flatten: bake node transforms, merge all meshes into one (or keep just `node`)
    import sf_gltf
    src = os.path.join(DOWNLOADS, 'models', name, f'{name}__{node or "flat"}.gltf')
    if node and os.path.exists(src) and os.path.getmtime(src) >= os.path.getmtime(src0):
        tris = -1   # prepared by Tools/art/prepare_assets.py (numpy splitter; huge scans)
    else:
        try:
            tris = sf_gltf.flatten(src0, src, node=node, mesh_name=want)
        except Exception as e:
            warn(f'model {name}: flatten failed ({e}); importing raw'); src = src0; tris = -1
    assets = _import_gltf(src, f'{folder}/_imp_{want}')
    meshes = [a for a in assets if isinstance(a, unreal.StaticMesh)]
    if not meshes:
        warn(f'model {name}: no static mesh'); return None
    if len(meshes) > 1:
        warn(f'model {name}: importer produced {len(meshes)} meshes; using the largest')
    sm = _rename(max(meshes, key=_tri_count), folder, want)
    # textures shipped with the scan
    tex_dir = os.path.join(DOWNLOADS, 'models', name, 'textures')
    sets = {}
    for f in glob.glob(os.path.join(tex_dir, '*')):
        mm = re.match(r'(.+?)_(diff|nor_gl|arm|rough|metal|ao)_\d+k\.(jpg|png)$', os.path.basename(f))
        if mm:
            sets.setdefault(mm.group(1), {})[mm.group(2)] = f
    import sf_materials
    statics = sm.get_editor_property('static_materials')
    changed = False
    for i, sl in enumerate(statics):
        mi = sl.get_editor_property('material_interface')
        slot = str(sl.get_editor_property('material_slot_name'))
        key = None
        for k in sorted(sets, key=len):
            if k.lower() == slot.lower() or slot.lower().startswith(k.lower()) or k.lower().startswith(slot.lower()):
                key = k
        if key is None and len(sets) == 1:
            key = next(iter(sets))
        if key is None or 'diff' not in sets[key]:
            continue
        s = sets[key]
        tx = {'BaseTex': _texture(s['diff'], f'{folder}/Tex', f'T_{key}_diff')}
        if 'nor_gl' in s: tx['NormalTex'] = _texture(s['nor_gl'], f'{folder}/Tex', f'T_{key}_nor', 'normal')
        if 'arm' in s: tx['ARMTex'] = _texture(s['arm'], f'{folder}/Tex', f'T_{key}_arm', 'masks')
        # model UVs come from a real glTF (top-left origin), so no V flip: TileV = -1 cancels the master's flip
        foliage = any(k in key.lower() for k in FOLIAGE_SLOT)
        # foliage whose base colour has no alpha (JPEG scans with geometric needles) is opaque: Nanite's fast path
        opaque_fol = foliage and os.path.splitext(s['diff'])[1].lower() in ('.jpg', '.jpeg')
        parent = ('/Game/Materials/M_SF_PBRFoliageOpaque' if opaque_fol else '/Game/Materials/M_SF_PBRFoliage') if foliage else '/Game/Materials/M_SF_PBR'
        new = sf_materials.instance(f'MI_{key}', parent, folder, scalars={'TileU': 1, 'TileV': -1}, textures=tx)
        sl.set_editor_property('material_interface', new)
        statics[i] = sl; changed = True
    if changed:
        sm.set_editor_property('static_materials', statics)
    _set_nanite(sm, _tri_count(sm) > 3000)
    if collide:
        _set_collision(sm, True)
    else:
        _no_collision(sm)   # e.g. million-triangle trees: invisible capsule colliders are placed instead
    eal.save_loaded_asset(sm)
    log(f'model {want} ({_tri_count(sm)} tris)')
    return sm

@guarded
def import_hdri(name):
    path = f'/Game/HDRI/HDR_{name}'
    if load(path):
        return load(path)
    f = os.path.join(DOWNLOADS, 'hdri', name + '_4k.hdr')
    if not os.path.exists(f):
        warn(f'hdri {name} missing'); return None
    ensure_dir('/Game/HDRI')
    import_file(f, '/Game/HDRI', f'HDR_{name}')
    return load(path)

# ---------------------------------------------------------------- characters
ANIMS = {'Xbot': ['idle', 'walk', 'run', 'sad_pose', 'sneak_pose', 'agree', 'headShake'], 'Michelle': ['SambaDance']}

@guarded
def import_characters():
    for c, anims in ANIMS.items():
        folder = f'/Game/Characters/{c}'
        unit = os.path.join(DOWNLOADS, 'chars', c + '.unit.glb')   # Tools/art/fix_mixamo_glb.py: armature scale baked
        old = load(f'{folder}/SK_{c}')
        if old:
            try:
                tall = old.get_bounds().box_extent.z * 2.0
            except Exception:
                tall = 999.0
            asset_file = os.path.join(PROJECT, 'Content', 'Characters', c, f'SK_{c}.uasset')
            stale = os.path.exists(unit) and (tall < 20.0 or (os.path.exists(asset_file) and os.path.getmtime(unit) > os.path.getmtime(asset_file)))
            if not stale:
                continue
            # imported at 1/100 scale from the unbaked glb (runtime x126 broke its rendering), or the prepared glb changed
            log(f'{c}: re-importing from {os.path.basename(unit)} (was {tall:.1f} cm tall)')
            unreal.EditorAssetLibrary.delete_directory(folder)
        src = unit if os.path.exists(unit) else os.path.join(DOWNLOADS, 'chars', c + '.glb')
        if not os.path.exists(src):
            warn(f'character {c} missing'); continue
        assets = _import_gltf(src, folder)
        assets = assets or _assets_in(folder)
        sk = next((a for a in assets if isinstance(a, unreal.SkeletalMesh)), None)
        if sk is None:
            error(f'{c}: no skeletal mesh imported'); continue
        _rename(sk, folder, f'SK_{c}')
        for a in _assets_in(folder, unreal.AnimSequence):
            n = a.get_name()
            for an in anims:
                if n == an or n.endswith('_' + an) or n.lower().endswith(an.lower()):
                    _rename(a, folder, f'A_{c}_{an}')
                    break
            else:
                warn(f'{c}: unmatched animation {n}')
        got = [an for an in anims if load(f'{folder}/A_{c}_{an}')]
        step(f'character {c}', anims=got)

# ---------------------------------------------------------------- audio
@guarded
def import_audio():
    root = os.path.join(SOURCE, 'Audio')
    n = 0
    for sub in ('Music', 'Amb', 'SFX'):
        files = {}
        for f in sorted(glob.glob(os.path.join(root, sub, '*.flac')) + glob.glob(os.path.join(root, sub, '*.wav'))):
            files[os.path.splitext(os.path.basename(f))[0]] = f   # .wav wins over .flac (repo ships FLAC)
        for name, f in sorted(files.items()):
            dest = f'/Game/Audio/{sub}'
            if load(f'{dest}/{name}'):
                continue
            ensure_dir(dest)
            import_file(f, dest, name)
            w = load(f'{dest}/{name}')
            if w is None:
                warn(f'audio {name} failed'); continue
            try:
                w.set_editor_property('looping', sub == 'Amb' or name.endswith('_loop'))
                eal.save_loaded_asset(w)
            except Exception as e:
                warn(f'audio settings {name}: {e}')
            n += 1
    step('audio', imported=n)

# ---------------------------------------------------------------- authored meshes
@guarded
def import_authored():
    expect = {'SM_Flake': 2}   # triangle count of the current authored version
    for name, folder, nanite in (('SM_Flake', '/Game/FX', False), ('SM_WineGlass', '/Game/Props', False)):
        cur = load(f'{folder}/{name}')
        if cur and (name not in expect or _tri_count(cur) == expect[name]):
            continue
        tmp = f'{folder}/_tmp_{name}'
        sm = _static_mesh(_import_gltf(os.path.join(SOURCE, 'Meshes', name + '.glb'), tmp))
        if sm is None:
            error(f'{name} did not import'); continue
        ensure_dir(folder)
        sm = _rename(sm, folder, name)
        eal.delete_directory(tmp)
        _no_collision(sm)
        _set_nanite(sm, nanite)
        if name == 'SM_WineGlass':
            glass = load('/Game/Materials/M_SF_Glass')
            if glass:
                sm.set_material(0, glass)
        eal.save_loaded_asset(sm)
        log(f'authored {name}')

def run(levels):
    step('import')
    calibrate()
    import_authored()
    import_characters()
    import_audio()
    scenes = {}
    for lv in levels:
        s = import_scene(lv)
        if s:
            scenes[lv] = s
            for m in s.get('models', []):
                import_model(m['name'])
            for mat in s.get('materials', {}).values():
                if mat.get('kind') in ('pbr', 'snowground') and mat.get('polyhaven'):
                    pbr_set(mat['polyhaven'])
            if s.get('env', {}).get('hdri'):
                import_hdri(s['env']['hdri'])
    import_model('wheelchair_01')
    return scenes
