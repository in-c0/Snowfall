#!/usr/bin/env python3
"""Fetch + prepare the scanned assets an art layer needs (Content/Data/Art/<Level>.json), before the UE content build.

  python3 Tools/art/prepare_assets.py L_Blizzard            (needs numpy; run from the project root or anywhere)

* Downloads Poly Haven models (glTF + textures at the layer's resolution), textures and HDRIs into SourceArt/Downloads
  (same layout sf_fetch.py uses), skipping files that are already there.
* Poly Haven tree scans ship several trees per file as separate nodes and millions of triangles; this splits every
  requested variant into its own glTF (node transform baked, trunk base moved to the origin), so Unreal imports one
  Nanite mesh per tree without the slow pure-Python flattener.
* Writes SourceArt/Downloads/art_manifest_<Level>.json with what was fetched (provenance: id, url, license, files).
"""
import json, os, sys, struct, urllib.request, hashlib
import numpy as np

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
DL = os.path.join(ROOT, 'SourceArt', 'Downloads')
UA = {'User-Agent': 'snowfall-build/1.0'}
CT = {5120: np.int8, 5121: np.uint8, 5122: np.int16, 5123: np.uint16, 5125: np.uint32, 5126: np.float32}
NC = {'SCALAR': 1, 'VEC2': 2, 'VEC3': 3, 'VEC4': 4}

import time
DEADLINE = float(os.environ.get('SF_PREP_SECONDS', '0')) or None   # stop early (resumable) when set
T0 = time.time()

class OutOfTime(Exception):
    pass

def get(url, path):
    """Resumable download (.part + HTTP Range), so a time-boxed shell can finish it over several runs."""
    if os.path.exists(path) and os.path.getsize(path) > 0:
        return False
    os.makedirs(os.path.dirname(path), exist_ok=True)
    part = path + '.part'
    have = os.path.getsize(part) if os.path.exists(part) else 0
    hdr = dict(UA)
    if have:
        hdr['Range'] = f'bytes={have}-'
    with urllib.request.urlopen(urllib.request.Request(url, headers=hdr), timeout=120) as r:
        mode = 'ab' if (have and r.status == 206) else 'wb'
        with open(part, mode) as f:
            while True:
                if DEADLINE and time.time() - T0 > DEADLINE:
                    raise OutOfTime(path)
                b = r.read(1 << 21)
                if not b:
                    break
                f.write(b)
    os.replace(part, path)
    return True

def files(aid):
    with urllib.request.urlopen(urllib.request.Request('https://api.polyhaven.com/files/' + aid, headers=UA), timeout=60) as r:
        return json.load(r)

def mat4(n):
    if 'matrix' in n:
        return np.array(n['matrix'], dtype=np.float64).reshape(4, 4).T
    t = n.get('translation', [0, 0, 0]); q = n.get('rotation', [0, 0, 0, 1]); s = n.get('scale', [1, 1, 1])
    x, y, z, w = q
    R = np.array([[1 - 2 * (y * y + z * z), 2 * (x * y - z * w), 2 * (x * z + y * w)],
                  [2 * (x * y + z * w), 1 - 2 * (x * x + z * z), 2 * (y * z - x * w)],
                  [2 * (x * z - y * w), 2 * (y * z + x * w), 1 - 2 * (x * x + y * y)]])
    M = np.eye(4); M[:3, :3] = R * np.array(s); M[:3, 3] = t
    return M

def split_variants(src, out_dir, name, variants):
    """variants: list of node names (or 'all' -> every mesh node). Writes <name>__<node>.gltf/.bin per variant."""
    if variants != 'all' and all(os.path.exists(os.path.join(out_dir, f'{name}__{v}.gltf')) for v in variants):
        return [{'variant': v, 'file': f'{name}__{v}.gltf', 'cached': True} for v in variants]
    j = json.load(open(src, encoding='utf-8'))
    base = os.path.dirname(src)
    bufs = [np.fromfile(os.path.join(base, b['uri']), dtype=np.uint8) for b in j['buffers']]
    def acc(i):
        a = j['accessors'][i]; bv = j['bufferViews'][a['bufferView']]
        dt = np.dtype(CT[a['componentType']]); nc = NC[a['type']]
        off = bv.get('byteOffset', 0) + a.get('byteOffset', 0)
        stride = bv.get('byteStride') or dt.itemsize * nc
        raw = bufs[bv['buffer']]
        if stride == dt.itemsize * nc:
            return np.frombuffer(raw[off:off + a['count'] * stride].tobytes(), dtype=dt).reshape(a['count'], nc) if nc > 1 else np.frombuffer(raw[off:off + a['count'] * stride].tobytes(), dtype=dt)
        idx = off + np.arange(a['count'])[:, None] * stride + np.arange(dt.itemsize * nc)[None, :]
        return np.frombuffer(raw[idx].tobytes(), dtype=dt).reshape(a['count'], nc)
    # world matrices of mesh nodes
    world = {}
    def walk(ni, parent):
        M = parent @ mat4(j['nodes'][ni])
        if 'mesh' in j['nodes'][ni]:
            world[ni] = M
        for c in j['nodes'][ni].get('children', []):
            walk(c, M)
    for r in j['scenes'][j.get('scene', 0)]['nodes']:
        walk(r, np.eye(4))
    names = {j['nodes'][ni].get('name', str(ni)): ni for ni in world}
    want = list(names) if variants == 'all' else variants
    written = []
    for vn in want:
        if vn not in names:
            print(f'  ! {name}: node {vn} not found ({list(names)[:8]})'); continue
        ni = names[vn]; M = world[ni]; N3 = np.linalg.inv(M[:3, :3]).T
        mesh = j['meshes'][j['nodes'][ni]['mesh']]
        prims = []
        for p in mesh['primitives']:
            at = p['attributes']
            P = acc(at['POSITION']).astype(np.float64) @ M[:3, :3].T + M[:3, 3]
            Nn = acc(at['NORMAL']).astype(np.float64) @ N3.T if 'NORMAL' in at else None
            if Nn is not None:
                Nn /= np.maximum(np.linalg.norm(Nn, axis=1, keepdims=True), 1e-12)
            UV = acc(at['TEXCOORD_0']) if 'TEXCOORD_0' in at else None
            TG = None
            if 'TANGENT' in at:
                tg = acc(at['TANGENT']).astype(np.float64)
                t3 = tg[:, :3] @ M[:3, :3].T; t3 /= np.maximum(np.linalg.norm(t3, axis=1, keepdims=True), 1e-12)
                TG = np.concatenate([t3, tg[:, 3:4]], axis=1)
            I = acc(p['indices']).astype(np.uint32).ravel()
            prims.append((p.get('material'), P, Nn, UV, TG, I))
        # recentre: trunk base at origin (x,z of the trunk/bark primitive, lowest y of everything)
        trunk = [pr for pr in prims if pr[0] is not None and any(k in j['materials'][pr[0]]['name'] for k in ('trunk', 'bark', 'branches'))]
        ref = trunk[0][1] if trunk else np.concatenate([pr[1] for pr in prims])
        low = ref[ref[:, 1] < ref[:, 1].min() + 0.3]
        c = np.array([low[:, 0].mean(), min(pr[1][:, 1].min() for pr in prims), low[:, 2].mean()])
        blob = bytearray(); views = []; accs = []; out_prims = []
        def add(arr, ctype, typ, target, mm=False):
            nonlocal blob
            while len(blob) % 4:
                blob.append(0)
            b = arr.tobytes()
            views.append({'buffer': 0, 'byteOffset': len(blob), 'byteLength': len(b), 'target': target}); blob += b
            a = {'bufferView': len(views) - 1, 'componentType': ctype, 'count': int(arr.shape[0]), 'type': typ}
            if mm:
                a['min'] = arr.min(axis=0).tolist(); a['max'] = arr.max(axis=0).tolist()
            accs.append(a); return len(accs) - 1
        tris = 0
        for m, P, Nn, UV, TG, I in prims:
            attrs = {'POSITION': add((P - c).astype(np.float32), 5126, 'VEC3', 34962, True)}
            if Nn is not None: attrs['NORMAL'] = add(Nn.astype(np.float32), 5126, 'VEC3', 34962)
            if UV is not None: attrs['TEXCOORD_0'] = add(UV.astype(np.float32), 5126, 'VEC2', 34962)
            if TG is not None: attrs['TANGENT'] = add(TG.astype(np.float32), 5126, 'VEC4', 34962)
            pr = {'attributes': attrs, 'indices': add(I, 5125, 'SCALAR', 34963)}
            if m is not None: pr['material'] = m
            out_prims.append(pr); tris += len(I) // 3
        stem = f'{name}__{vn}'
        out = {'asset': {'version': '2.0', 'generator': 'snowfall prepare_assets'}, 'scene': 0, 'scenes': [{'nodes': [0]}],
               'nodes': [{'name': stem, 'mesh': 0}], 'meshes': [{'name': stem, 'primitives': out_prims}],
               'accessors': accs, 'bufferViews': views, 'buffers': [{'uri': stem + '.bin', 'byteLength': len(blob)}]}
        for k in ('materials', 'textures', 'images', 'samplers'):
            if k in j: out[k] = j[k]
        open(os.path.join(out_dir, stem + '.bin'), 'wb').write(bytes(blob))
        json.dump(out, open(os.path.join(out_dir, stem + '.gltf'), 'w', encoding='utf-8'))
        size = (P.max(axis=0) - P.min(axis=0)) if prims else 0
        print(f'  {stem}: {tris:,} tris, base offset {np.round(c, 2).tolist()}')
        written.append({'variant': vn, 'file': stem + '.gltf', 'triangles': int(tris)})
    return written

def chunk_variant(out_dir, stem, max_tris):
    """Split one prepared variant into spatial chunks of <= max_tris triangles (<stem>_k<i>.gltf, same origin), listed in
    <stem>.chunks.json. Unreal's glTF import + Nanite build of a 7M-triangle tree needs more RAM than a 16 GB machine has
    (it crashed the content build); ~1M-triangle pieces import one at a time and render as one tree."""
    man = os.path.join(out_dir, stem + '.chunks.json')
    src = os.path.join(out_dir, stem + '.gltf')
    if os.path.exists(man) and os.path.getmtime(man) >= os.path.getmtime(src):
        return json.load(open(man))
    j = json.load(open(src, encoding='utf-8'))
    raw = np.fromfile(os.path.join(out_dir, j['buffers'][0]['uri']), dtype=np.uint8)
    def acc(i):
        a = j['accessors'][i]; bv = j['bufferViews'][a['bufferView']]
        dt = np.dtype(CT[a['componentType']]); nc = NC[a['type']]
        off = bv.get('byteOffset', 0) + a.get('byteOffset', 0)
        arr = np.frombuffer(raw[off:off + a['count'] * dt.itemsize * nc].tobytes(), dtype=dt)
        return arr.reshape(a['count'], nc) if nc > 1 else arr
    prims = []
    for p in j['meshes'][0]['primitives']:
        attrs = {k: acc(v) for k, v in p['attributes'].items()}
        prims.append((p.get('material'), attrs, acc(p['indices']).reshape(-1, 3)))
    # every triangle: (primitive, index) + centroid; recursive median split along the longest axis
    pid = np.concatenate([np.full(len(I), k, np.int32) for k, (_, _, I) in enumerate(prims)])
    tid = np.concatenate([np.arange(len(I), dtype=np.int64) for _, _, I in prims])
    cen = np.concatenate([a['POSITION'][I].mean(axis=1) for _, a, I in prims]).astype(np.float32)
    groups = []
    def split(idx):
        if len(idx) <= max_tris:
            groups.append(idx); return
        c = cen[idx]; ax = int(np.argmax(c.max(axis=0) - c.min(axis=0)))
        h = len(idx) // 2
        part = np.argpartition(c[:, ax], h)
        split(idx[part[:h]]); split(idx[part[h:]])
    split(np.arange(len(cen)))
    chunks = []
    for gi, idx in enumerate(groups):
        cstem = f'{stem}_k{gi}'
        blob = bytearray(); views = []; accs = []; out_prims = []
        def add(arr, ctype, typ, target, mm=False):
            nonlocal blob
            while len(blob) % 4:
                blob.append(0)
            b = np.ascontiguousarray(arr).tobytes()
            views.append({'buffer': 0, 'byteOffset': len(blob), 'byteLength': len(b), 'target': target}); blob += b
            a = {'bufferView': len(views) - 1, 'componentType': ctype, 'count': int(arr.shape[0]), 'type': typ}
            if mm:
                a['min'] = arr.min(axis=0).tolist(); a['max'] = arr.max(axis=0).tolist()
            accs.append(a); return len(accs) - 1
        tris = 0
        for k, (m, at, I) in enumerate(prims):
            sel = tid[idx[pid[idx] == k]]
            if len(sel) == 0:
                continue
            T = I[np.sort(sel)]
            used, inv = np.unique(T.ravel(), return_inverse=True)
            A = {}
            for name, arr in at.items():
                typ = {2: 'VEC2', 3: 'VEC3', 4: 'VEC4'}[arr.shape[1]]
                A[name] = add(arr[used].astype(np.float32), 5126, typ, 34962, name == 'POSITION')
            pr = {'attributes': A, 'indices': add(inv.astype(np.uint32), 5125, 'SCALAR', 34963)}
            if m is not None: pr['material'] = m
            out_prims.append(pr); tris += len(T)
        out = {k: v for k, v in j.items() if k in ('asset', 'materials', 'textures', 'images', 'samplers')}
        out.update({'scene': 0, 'scenes': [{'nodes': [0]}], 'nodes': [{'name': cstem, 'mesh': 0}],
                    'meshes': [{'name': cstem, 'primitives': out_prims}], 'accessors': accs, 'bufferViews': views,
                    'buffers': [{'uri': cstem + '.bin', 'byteLength': len(blob)}]})
        open(os.path.join(out_dir, cstem + '.bin'), 'wb').write(bytes(blob))
        json.dump(out, open(os.path.join(out_dir, cstem + '.gltf'), 'w', encoding='utf-8'))
        chunks.append({'node': cstem.split('__', 1)[1], 'file': cstem + '.gltf', 'triangles': int(tris)})
        print(f'    {cstem}: {tris:,} tris')
    rec = {'variant': stem, 'max_tris': max_tris, 'chunks': chunks}
    json.dump(rec, open(man, 'w'), indent=1)
    return rec

def derive_clean_snow(src_id, dst_id, cfg):
    """Fresh-powder variant of a snow scan: the scan's dark footprint/crease marks repeat every tile and read as a
    pattern from eye height, so they are painted out (dark-vs-local-mean mask, dilated + feathered) in every map."""
    from PIL import Image, ImageFilter
    Image.MAX_IMAGE_PIXELS = None
    sdir = os.path.join(DL, 'textures', src_id); ddir = os.path.join(DL, 'textures', dst_id)
    os.makedirs(ddir, exist_ok=True)
    maps = {}
    for short in ('diff', 'nor', 'arm', 'disp'):
        for ext in ('.png', '.jpg'):
            p = os.path.join(sdir, f'{src_id}_{short}{ext}')
            if os.path.exists(p):
                maps[short] = p
    outs = {s: os.path.join(ddir, f'{dst_id}_{s}.png') for s in maps}
    stamp = os.path.join(ddir, 'derive.json'); want = json.dumps({'from': src_id, 'cfg': cfg, 'v': 2}, sort_keys=True)
    if os.path.exists(stamp) and open(stamp).read() == want and all(os.path.exists(o) for o in outs.values()):
        return {'derived': dst_id, 'cached': True}
    # mid-scale darkness relative to an upward-biased background: grain (<3 px) is ignored and kept, marks are found
    G = lambda im, r: im.filter(ImageFilter.GaussianBlur(r))
    blur_r = cfg.get('blur_px', 60); thr = cfg.get('dark_threshold', 0.035)
    diff = Image.open(maps['diff']).convert('RGB')
    Lim = diff.convert('L')
    Ls = np.asarray(G(Lim, 3), dtype=np.float32) / 255.0
    bg0 = np.asarray(G(Lim, blur_r), dtype=np.float32) / 255.0
    bg = np.asarray(G(Image.fromarray((np.maximum(Ls, bg0) * 255).astype(np.uint8)), blur_r), dtype=np.float32) / 255.0
    d = Ls - bg                                     # negative inside dark marks
    m = Image.fromarray(((d < -thr) * 255).astype(np.uint8))
    m = m.filter(ImageFilter.MaxFilter(cfg.get('grow_px', 7))).filter(ImageFilter.GaussianBlur(cfg.get('feather_px', 5)))
    a = np.asarray(m, dtype=np.float32) / 255.0
    cover = float((a > 0.5).mean())
    lift = np.clip(-np.asarray(G(Image.fromarray((np.clip(-d, 0, 1) * 255).astype(np.uint8)), 2), dtype=np.float32) / 255.0, -1, 0) * -1.0
    for short, p in maps.items():
        img = diff if short == 'diff' else Image.open(p)
        mode = img.mode
        arr = np.asarray(img).astype(np.float32)
        aa = a[..., None] if arr.ndim == 3 else a
        if short == 'diff':
            # lift the luminance deficit only: the scan's grain survives
            out = arr + (lift * a * 255.0)[..., None]
        elif short == 'arm':
            out = arr.copy(); out[..., 0] = out[..., 0] + lift * a * 255.0   # AO channel carries the marks too
        else:
            src = img if mode in ('RGB', 'L', 'RGBA') else Image.fromarray(arr.astype(np.int32))
            bl = np.asarray(G(src, 8)).astype(np.float32)
            out = arr * (1 - aa) + bl * aa
        if mode in ('I;16', 'I'):
            Image.fromarray(np.clip(out, 0, 65535).astype(np.uint16)).save(outs[short])
        else:
            Image.fromarray(np.clip(out, 0, 255).astype(np.uint8), mode if mode in ('RGB', 'L', 'RGBA') else 'RGB').save(outs[short])
    open(stamp, 'w').write(want)
    print(f'  {dst_id}: painted out {cover * 100:.1f}% of {src_id} (marks)')
    return {'derived': dst_id, 'from': src_id, 'op': 'remove_dark_marks', 'coverage': cover}

def main(level):
    art = json.load(open(os.path.join(ROOT, 'Content', 'Data', 'Art', f'{level}.json'), encoding='utf-8'))
    man = {'level': level, 'assets': []}
    for aid, a in art.get('assets', {}).items():
        if a.get('source') != 'polyhaven':
            continue
        kind = a.get('type', 'model'); res = a.get('res', '2k')
        d = files(aid)
        rec = {'id': aid, 'type': kind, 'url': f'https://polyhaven.com/a/{aid}', 'license': 'CC0 1.0', 'res': res, 'files': []}
        if kind == 'model':
            g = d['gltf'][res]['gltf']
            folder = os.path.join(DL, 'models', aid)
            get(g['url'], os.path.join(folder, aid + '.gltf')); rec['files'].append(g['url'])
            for rel, inc in g['include'].items():
                get(inc['url'], os.path.join(folder, rel)); rec['files'].append(inc['url'])
            if a.get('variants'):
                rec['variants'] = split_variants(os.path.join(folder, aid + '.gltf'), folder, aid, a['variants'])
                if a.get('chunk_tris'):
                    rec['chunks'] = [chunk_variant(folder, f'{aid}__{v}', int(a['chunk_tris'])) for v in a['variants']]
        elif kind == 'texture':
            folder = os.path.join(DL, 'textures', aid)
            for key, short in (('Diffuse', 'diff'), ('nor_gl', 'nor'), ('arm', 'arm'), ('Displacement', 'disp')):
                if key in d and res in d[key]:
                    src = d[key][res].get('png') or d[key][res].get('jpg')
                    ext = '.png' if 'png' in d[key][res] else '.jpg'
                    get(src['url'], os.path.join(folder, f'{aid}_{short}{ext}')); rec['files'].append(src['url'])
        elif kind == 'hdri':
            u = d['hdri'][res]['hdr']['url']
            get(u, os.path.join(DL, 'hdri', f'{aid}_{res}.hdr')); rec['files'].append(u)
        print(f'{aid}: ok ({kind})')
        man['assets'].append(rec)
    for dst, cfg in art.get('derived_textures', {}).items():
        man.setdefault('derived', []).append(derive_clean_snow(cfg['from'], dst, cfg))
    json.dump(man, open(os.path.join(DL, f'art_manifest_{level}.json'), 'w'), indent=1)

if __name__ == '__main__':
    try:
        main(sys.argv[1] if len(sys.argv) > 1 else 'L_Blizzard')
        print('PREPARE DONE')
    except OutOfTime as e:
        print(f'PREPARE INCOMPLETE (time budget), resume by running again: {e}')
        sys.exit(3)
