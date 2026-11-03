"""Versioned art layer on top of the WebGL export: Content/Data/Art/<level>.json.

The three.js export (SourceArt/Scenes) keeps the story layout: road, markers, memorial objects, lights. The art layer
is where hand-made art decisions live, so a clean regeneration rebuilds the same improved environment:
  * suppress_meshes   - exported prototype geometry to drop (e.g. procedural trees)
  * assets            - scanned assets with provenance (prepared by Tools/art/prepare_assets.py)
  * ground / env      - material and lighting decisions
  * scatter / place   - deterministic placements (seeded), plus explicit hand placements
  * keep_clear        - the road and story spots nothing may cover
  * shots             - extra evidence cameras (near-field, side, back, ground)
Everything here is deterministic: same JSON + same downloads -> same level.
"""
import json, math, os, random, struct, zlib
import unreal
from sf_common import PROJECT, SCENES, DOWNLOADS, REPORT_DIR, eal, log, warn, error, step, load, c3
import sf_import, sf_materials

ART_DIR = os.path.join(PROJECT, 'Content', 'Data', 'Art')
eas = unreal.get_editor_subsystem(unreal.EditorActorSubsystem)


def layer(level):
    if os.environ.get('SF_NOART'):
        return None
    p = os.path.join(ART_DIR, f'{level}.json')
    return json.load(open(p, encoding='utf-8')) if os.path.exists(p) else None


# ---------------------------------------------------------------- scene merge (before the level is generated)
def merge_scene(level, scene):
    a = layer(level)
    if not a:
        return scene
    scene = dict(scene)
    drop = set((a.get('suppress_meshes') or {}).get('ids', []))
    scene['meshes'] = [m for m in scene.get('meshes', []) if m['id'] not in drop]
    env = dict(scene.get('env', {}))
    e = a.get('env', {})
    for k in ('hdri', 'envIntensity'):
        if k in e:
            env[k] = e[k]
    scene['env'] = env
    if e.get('sun'):
        lights = []
        for l in scene.get('lights', []):
            if l.get('type') == 'directional':
                l = dict(l)
                sun = e['sun']
                l['intensity'] = sun.get('intensity', l.get('intensity'))
                l['color'] = sun.get('color', l.get('color'))
                l['castShadow'] = sun.get('cast_shadows', l.get('castShadow'))
                l['source_angle'] = sun.get('source_angle_deg', 1.0)
            lights.append(l)
        scene['lights'] = lights
    over = a.get('models', {})   # per-model overrides of the export (e.g. how much snow lies on the memorial objects)
    if over:
        scene['models'] = [dict(m, **{k: v for k, v in over.get(m.get('name'), {}).items() if k != 'note'}) for m in scene.get('models', [])]
    g = a.get('ground')
    if g:
        mats = dict(scene.get('materials', {}))
        m = dict(mats.get(g['material'], {}))
        m['art_ground'] = g
        mats[g['material']] = m
        scene['materials'] = mats
    # evidence cameras ('shots') are read by ASFAutoShot straight from the JSON, so old and new levels share views
    step(f'art merge {level}', dropped=len(drop), shots=len(a.get('shots', [])))
    return scene


# ---------------------------------------------------------------- terrain height (from the exported ground mesh)
class Heightfield:
    """Bilinear height lookup on the exported snow-ground grid (three.js metres)."""
    def __init__(self, level, scene):
        self.ok = False
        ground = [m for m in scene.get('meshes', []) if scene['materials'].get(m.get('material'), {}).get('kind') == 'snowground']
        if not ground:
            return
        path = os.path.join(SCENES, level, ground[0]['file'])
        pts = _glb_positions(path)
        M = ground[0].get('matrix')
        if M:
            pts = [(M[0] * x + M[4] * y + M[8] * z + M[12], M[1] * x + M[5] * y + M[9] * z + M[13], M[2] * x + M[6] * y + M[10] * z + M[14]) for x, y, z in pts]
        xs = sorted(set(round(p[0], 3) for p in pts)); zs = sorted(set(round(p[2], 3) for p in pts))
        self.x0, self.z0 = xs[0], zs[0]
        self.dx = (xs[-1] - xs[0]) / max(1, len(xs) - 1); self.dz = (zs[-1] - zs[0]) / max(1, len(zs) - 1)
        self.nx, self.nz = len(xs), len(zs)
        self.h = {}
        for x, y, z in pts:
            self.h[(int(round((x - self.x0) / self.dx)), int(round((z - self.z0) / self.dz)))] = y
        self.ok = len(self.h) > 100
        log(f'heightfield {self.nx}x{self.nz} cells {self.dx:.2f}x{self.dz:.2f} m')

    def __call__(self, x, z):
        if not self.ok:
            return 0.0
        fx = (x - self.x0) / self.dx; fz = (z - self.z0) / self.dz
        ix = max(0, min(self.nx - 2, int(math.floor(fx)))); iz = max(0, min(self.nz - 2, int(math.floor(fz))))
        tx = min(1.0, max(0.0, fx - ix)); tz = min(1.0, max(0.0, fz - iz))
        g = lambda i, j: self.h.get((i, j), 0.0)
        return (g(ix, iz) * (1 - tx) + g(ix + 1, iz) * tx) * (1 - tz) + (g(ix, iz + 1) * (1 - tx) + g(ix + 1, iz + 1) * tx) * tz


def _glb_positions(path):
    data = open(path, 'rb').read()
    jl = struct.unpack_from('<I', data, 12)[0]
    j = json.loads(data[20:20 + jl])
    bin0 = 20 + jl + 8
    out = []
    for mesh in j['meshes']:
        for p in mesh['primitives']:
            a = j['accessors'][p['attributes']['POSITION']]
            bv = j['bufferViews'][a['bufferView']]
            off = bin0 + bv.get('byteOffset', 0) + a.get('byteOffset', 0)
            stride = bv.get('byteStride') or 12
            for i in range(a['count']):
                out.append(struct.unpack_from('<3f', data, off + i * stride))
    return out


# ---------------------------------------------------------------- placement
def _poisson(rng, x0, x1, z0, z1, r):
    """Deterministic dart throwing on a grid (Bridson-lite)."""
    cell = r / math.sqrt(2)
    grid = {}
    pts = []
    n = int(((x1 - x0) * (z1 - z0)) / (r * r) * 2.2) + 10
    for _ in range(n * 6):
        x = rng.uniform(x0, x1); z = rng.uniform(z0, z1)
        gx, gz = int((x - x0) / cell), int((z - z0) / cell)
        ok = True
        for i in range(gx - 2, gx + 3):
            for j in range(gz - 2, gz + 3):
                q = grid.get((i, j))
                if q and (q[0] - x) ** 2 + (q[1] - z) ** 2 < r * r:
                    ok = False; break
            if not ok:
                break
        if ok:
            grid[(gx, gz)] = (x, z); pts.append((x, z))
            if len(pts) >= n:
                break
    return pts


def _density(table, x):
    if not table:
        return 1.0
    t = sorted(table)
    if x <= t[0][0]:
        return t[0][1]
    for (xa, va), (xb, vb) in zip(t, t[1:]):
        if x <= xb:
            return va + (vb - va) * (x - xa) / max(1e-6, xb - xa)
    return t[-1][1]


def _clear(a, x, z, pad):
    for k in a.get('keep_clear', []):
        if 'x' in k and k['x'][0] - pad <= x <= k['x'][1] + pad:
            return False
        for px, pz, rr in k.get('points', []):
            if (px - x) ** 2 + (pz - z) ** 2 < (rr + pad) ** 2:
                return False
    return True


class Placer:
    def __init__(self, level, a, hf):
        self.level, self.a, self.hf = level, a, hf
        self.sets = {}          # (asset, variant) -> [transforms]
        self.colliders = []     # (x, y, z, radius, height) three metres
        self.meshes = {}        # (asset, variant) -> StaticMesh
        self.collide = set()

    def mesh(self, asset, vi):
        """-> list of StaticMeshes that together make this variant (huge scans are pre-split into chunks)."""
        key = (asset, vi)
        if key in self.meshes:
            return self.meshes[key]
        spec = self.a['assets'][asset]
        variants = spec.get('variants')
        node = variants[vi % len(variants)] if variants else None
        big = 'tree' in asset and not asset.startswith(('tree_stump', 'dead_tree'))
        nodes = [node]
        man = os.path.join(DOWNLOADS, 'models', asset, f'{asset}__{node}.chunks.json') if node else None
        if man and os.path.exists(man):
            nodes = [c['node'] for c in json.load(open(man))['chunks']]
        out = []
        for n in nodes:
            sm = sf_import.import_model(asset, n, collide=not big)
            if sm is not None:
                out.append(sm)
            unreal.SystemLibrary.collect_garbage()   # one multi-million-triangle import at a time
        if len(out) != len(nodes):
            warn(f'art {asset}#{vi}: {len(out)}/{len(nodes)} pieces imported; variant skipped')
            out = []
        self.meshes[key] = out
        return out

    def add(self, asset, vi, x, z, yaw, scale, sink, tilt, rng, sink_frac=None, collider=None, collide=False):
        sms = self.mesh(asset, vi)
        if not sms:
            return
        y = self.hf(x, z)
        if sink_frac:
            bb = sms[0].get_bounding_box()
            sink = (bb.max.z - bb.min.z) / 100.0 * scale * sink_frac
        loc = c3([x, y - sink, z])
        rot = unreal.Rotator(roll=rng.uniform(-tilt, tilt), pitch=rng.uniform(-tilt, tilt), yaw=yaw)
        self.sets.setdefault((asset, vi), []).append(unreal.Transform(loc, rot, unreal.Vector(scale, scale, scale)))
        if collide:
            self.collide.add((asset, vi))
        if collider:
            self.colliders.append((x, y, z, collider['radius'] * scale, collider['height']))

    def scatter(self, s):
        rng = random.Random(s.get('seed', 1))
        assets = s['asset'] if isinstance(s['asset'], list) else [s['asset']]
        variants = s.get('variants', [0])
        pad = s.get('clear_pad', 0.6)
        n = 0
        for x, z in _poisson(rng, s['x'][0], s['x'][1], s['z'][1], s['z'][0], s['spacing']):
            if rng.random() > s.get('keep', 1.0) * _density(s.get('density_x'), x):
                continue
            if not _clear(self.a, x, z, pad):
                continue
            asset = assets[rng.randrange(len(assets))]
            vi = variants[rng.randrange(len(variants))] if self.a['assets'][asset].get('variants') else 0
            sc = rng.uniform(*s.get('scale', [1, 1]))
            self.add(asset, vi, x, z, rng.uniform(0, 360), sc, s.get('sink', 0.0), s.get('tilt_deg', 0.0), rng,
                     sink_frac=s.get('sink_frac'), collider=s.get('collider'), collide=s.get('collide', False))
            n += 1
        return n

    def place(self, p):
        rng = random.Random(zlib.crc32(json.dumps(p, sort_keys=True).encode()))
        self.add(p['asset'], p.get('variant', 0), p['pos'][0], p['pos'][1], p.get('yaw', 0.0), p.get('scale', 1.0),
                 p.get('sink', 0.0), 0.0, rng, sink_frac=p.get('sink_frac'), collider=p.get('collider'), collide=p.get('collide', False))

    def spawn(self):
        total = 0
        for (asset, vi), xs in sorted(self.sets.items(), key=lambda kv: (kv[0][0], kv[0][1])):
            for pi, sm in enumerate(self.meshes[(asset, vi)]):
                act = eas.spawn_actor_from_class(unreal.SFInstanceSet, unreal.Vector(0, 0, 0), unreal.Rotator(0, 0, 0))
                act.set_actor_label(f'Art_{asset}_{vi}' + (f'_k{pi}' if len(self.meshes[(asset, vi)]) > 1 else ''))
                act.tags = [unreal.Name('Art'), unreal.Name(asset)]
                comp = act.get_editor_property('instances')
                comp.set_static_mesh(sm)
                comp.add_instances(xs, False, True)
                act.configure(True, (asset, vi) in self.collide, 0.0, True)
                try:
                    act.set_folder_path('Art')
                except Exception:
                    pass
            total += len(xs)
        if self.colliders:
            cyl = load('/Engine/BasicShapes/Cylinder')
            act = eas.spawn_actor_from_class(unreal.SFInstanceSet, unreal.Vector(0, 0, 0), unreal.Rotator(0, 0, 0))
            act.set_actor_label('Art_TrunkColliders')
            act.tags = [unreal.Name('Art'), unreal.Name('Colliders')]
            comp = act.get_editor_property('instances')
            comp.set_static_mesh(cyl)
            xs = []
            for x, y, z, r, h in self.colliders:
                loc = c3([x, y + h / 2.0, z])
                xs.append(unreal.Transform(loc, unreal.Rotator(0, 0, 0), unreal.Vector(r * 2.0, r * 2.0, h)))   # cylinder is 1 m wide/high
            comp.add_instances(xs, False, True)
            act.configure(False, True, 0.0, True)
            comp.set_editor_property('visible', False)
            comp.set_editor_property('hidden_in_game', True)
            try:
                act.set_folder_path('Art')
            except Exception:
                pass
        return total


def _snow_on_asset(asset, amount):
    """Snow settles on every material of a scanned asset (its M_SF_PBR / foliage instances). Also moves foliage instances
    imported before the opaque foliage master existed onto it when their texture has no alpha."""
    opaque = load('/Game/Materials/M_SF_PBRFoliageOpaque')
    for p in eal.list_assets(f'/Game/Models/{asset}', recursive=False, include_folder=False):
        mi = eal.load_asset(p)
        if isinstance(mi, unreal.MaterialInstanceConstant):
            par = mi.get_editor_property('parent')
            if opaque and par and par.get_name() == 'M_SF_PBRFoliage':
                try:
                    tex = unreal.MaterialEditingLibrary.get_material_instance_texture_parameter_value(mi, 'BaseTex')
                    aid = tex.get_editor_property('asset_import_data') if tex else None
                    src = aid.get_first_filename() if aid else ''
                except Exception as e:
                    warn(f'art {asset}: cannot read texture source ({e})'); src = ''
                if src.lower().endswith(('.jpg', '.jpeg')):
                    mi.set_editor_property('parent', opaque)
                    log(f'art {asset}: {mi.get_name()} -> opaque foliage')
            unreal.MaterialEditingLibrary.set_material_instance_scalar_parameter_value(mi, 'SnowAmount', float(amount))
            unreal.MaterialEditingLibrary.update_material_instance(mi)
            eal.save_loaded_asset(mi)


# ---------------------------------------------------------------- import pass (one editor process per few million triangles)
def _pieces(a):
    """[(asset, node, triangles)] every mesh the layer needs, chunks expanded."""
    out = []
    for asset, spec in a.get('assets', {}).items():
        if spec.get('type', 'model') != 'model':
            continue
        for node in (spec.get('variants') or [None]):
            man = os.path.join(DOWNLOADS, 'models', asset, f'{asset}__{node}.chunks.json') if node else None
            if man and os.path.exists(man):
                out += [(asset, c['node'], c['triangles']) for c in json.load(open(man))['chunks']]
            else:
                out.append((asset, node, 0))
    return out


def import_pass(level):
    """Import missing art meshes until SF_ART_BUDGET triangles were imported in this process, then stop.
    Logs ART_IMPORT_COMPLETE when nothing is missing (the verify script re-launches the editor until then)."""
    a = layer(level)
    if not a:
        log('ART_IMPORT_COMPLETE (no layer)'); return
    budget = int(os.environ.get('SF_ART_BUDGET', '1800000'))
    done_tris, missing = 0, 0
    for asset, node, tris in _pieces(a):
        want = sf_import.re.sub(r'[^A-Za-z0-9_]', '_', node or asset)
        if load(f'/Game/Models/{asset}/{want}'):
            continue
        if done_tris and done_tris + tris > budget:
            missing += 1; continue
        big = 'tree' in asset and not asset.startswith(('tree_stump', 'dead_tree'))
        sm = sf_import.import_model(asset, node, collide=not big)
        done_tris += tris
        if sm is None:
            warn(f'art import {asset}/{want} failed')
        unreal.EditorAssetLibrary.save_directory(f'/Game/Models/{asset}', only_if_is_dirty=True, recursive=True)
        unreal.SystemLibrary.collect_garbage()
    step(f'art import {level}', imported_tris=done_tris, missing=missing)
    if missing == 0:
        log('ART_IMPORT_COMPLETE')


def _repair_slots(pl):
    """Slots the scan ships without textures (pine: trunk_c, dead_branches) kept the importer's plain material, which
    lacks the instanced-mesh usage flag and renders as the engine default in game (warnings in tag ch1). Give each such
    slot the asset's closest textured instance (shared name token, else bark/trunk, else the first)."""
    for (asset, vi), sms in sorted(pl.meshes.items()):
        mis = [eal.load_asset(p) for p in eal.list_assets(f'/Game/Models/{asset}', recursive=False, include_folder=False)]
        mis = [m for m in mis if isinstance(m, unreal.MaterialInstanceConstant)]
        if not mis:
            continue
        for sm in sms:
            statics = sm.get_editor_property('static_materials'); changed = False
            for i, sl in enumerate(statics):
                cur = sl.get_editor_property('material_interface')
                if isinstance(cur, unreal.MaterialInstanceConstant) and cur.get_path_name().startswith(f'/Game/Models/{asset}/MI_'):
                    continue
                slot = str(sl.get_editor_property('material_slot_name')).lower()
                toks = set(slot.replace('-', '_').split('_')) - {asset.lower(), 'pine', 'tree', '01', '02', 'lod0'}
                def score(m):
                    n = m.get_name().lower()
                    return (sum(1 for t in toks if t and t in n), 'trunk' in n or 'bark' in n)
                best = max(mis, key=score)
                sm.set_material(i, best); changed = True   # (editing static_materials did not persist: tag ch2)
                try:   # the importer's material stays loaded elsewhere; let it render on instances anyway
                    if isinstance(cur, unreal.Material):
                        cur.set_editor_property('used_with_instanced_static_meshes', True); eal.save_loaded_asset(cur)
                except Exception as e:
                    warn(f'art {cur.get_name() if cur else "?"}: {e}')
                log(f'art {sm.get_name()}: slot {slot} -> {best.get_name()}')
            if changed:
                eal.save_loaded_asset(sm)


def _ensure_nanite(pl):
    """Every art mesh must render through Nanite. A ProfileGPU of the walk (tag gp1) showed 60 ms of non-Nanite depth+base
    pass draws once the pines were in view, so check each mesh and rebuild it with Nanite on where it is off."""
    sub = unreal.get_editor_subsystem(unreal.StaticMeshEditorSubsystem)
    for (asset, vi), sms in sorted(pl.meshes.items()):
        for sm in sms:
            ns = sm.get_editor_property('nanite_settings')
            on = bool(ns.get_editor_property('enabled'))
            try:
                lod0 = sub.get_number_verts(sm, 0)
            except Exception:
                lod0 = -1
            log(f'art nanite {sm.get_name()}: enabled={on} lod0_verts={lod0}')
            if not on:
                ns.set_editor_property('enabled', True)
                try:
                    sub.set_nanite_settings(sm, ns, True)
                except Exception as e:
                    warn(f'art nanite {sm.get_name()}: {e}')
                    sm.set_editor_property('nanite_settings', ns)
                eal.save_loaded_asset(sm)
                log(f'art nanite {sm.get_name()}: rebuilt with Nanite')


# ---------------------------------------------------------------- apply (after the level is generated, before save)
def apply(level, scene, calib):
    a = layer(level)
    if not a:
        return
    hf = Heightfield(level, scene)
    pl = Placer(level, a, hf)
    counts = {}
    for s in a.get('scatter', []):
        counts[s['name']] = pl.scatter(s)
    for p in a.get('place', []):
        pl.place(p)
    for asset, spec in a.get('assets', {}).items():
        if spec.get('type', 'model') == 'model' and 'snow' in spec and any(k[0] == asset for k in pl.sets):
            _snow_on_asset(asset, spec['snow'])
    _ensure_nanite(pl)
    _repair_slots(pl)
    total = pl.spawn()
    rec = {'level': level, 'version': a.get('version'), 'scatter': counts, 'instances': total, 'colliders': len(pl.colliders),
           'meshes': {f'{k[0]}#{k[1]}': [m.get_path_name() for m in v] for k, v in pl.meshes.items()}}
    json.dump(rec, open(os.path.join(REPORT_DIR, f'{level}_art.json'), 'w'), indent=1)
    step(f'art apply {level}', instances=total, colliders=len(pl.colliders), **counts)
