"""Pure-Python glTF flattener: bakes every node transform and merges all meshes of a scan into ONE mesh
(one primitive per material), so the importer produces a single StaticMesh with one slot per material.
With node=..., only that node (and its children) is kept, with the node's own transform left out."""
import json, math, os, struct

_CT = {5120: ('b', 1), 5121: ('B', 1), 5122: ('h', 2), 5123: ('H', 2), 5125: ('I', 4), 5126: ('f', 4)}
_NC = {'SCALAR': 1, 'VEC2': 2, 'VEC3': 3, 'VEC4': 4, 'MAT4': 16}

def _mat_mul(a, b):  # column-major 4x4
    return [sum(a[r + 4 * k] * b[k + 4 * c] for k in range(4)) for c in range(4) for r in range(4)]

def _node_matrix(n):
    if 'matrix' in n:
        return list(n['matrix'])
    t = n.get('translation', [0, 0, 0]); r = n.get('rotation', [0, 0, 0, 1]); s = n.get('scale', [1, 1, 1])
    x, y, z, w = r
    R = [1 - 2 * (y * y + z * z), 2 * (x * y + z * w), 2 * (x * z - y * w),
         2 * (x * y - z * w), 1 - 2 * (x * x + z * z), 2 * (y * z + x * w),
         2 * (x * z + y * w), 2 * (y * z - x * w), 1 - 2 * (x * x + y * y)]
    return [R[0] * s[0], R[1] * s[0], R[2] * s[0], 0, R[3] * s[1], R[4] * s[1], R[5] * s[1], 0,
            R[6] * s[2], R[7] * s[2], R[8] * s[2], 0, t[0], t[1], t[2], 1]

IDENT = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]

def flatten(src, dst, node=None, mesh_name=None):
    base = os.path.dirname(src)
    j = json.load(open(src, encoding='utf-8'))
    bufs = [open(os.path.join(base, b['uri']), 'rb').read() for b in j['buffers']]

    def read(ai):
        a = j['accessors'][ai]; bv = j['bufferViews'][a['bufferView']]
        fmt, size = _CT[a['componentType']]; nc = _NC[a['type']]
        stride = bv.get('byteStride') or size * nc
        off = bv.get('byteOffset', 0) + a.get('byteOffset', 0)
        data = bufs[bv['buffer']]
        out = []
        norm = a.get('normalized', False)
        for i in range(a['count']):
            v = struct.unpack_from('<' + fmt * nc, data, off + i * stride)
            if norm and fmt != 'f':
                d = {'b': 127.0, 'B': 255.0, 'h': 32767.0, 'H': 65535.0}[fmt]
                v = tuple(max(-1.0, x / d) for x in v)
            out.append(v)
        return out

    # world matrices
    worlds = []   # (node_index, matrix)
    def walk(ni, parent, keep):
        n = j['nodes'][ni]
        if node is not None and n.get('name') == node:
            m, keep = IDENT, True
        else:
            m = _mat_mul(parent, _node_matrix(n))
        if keep and 'mesh' in n:
            worlds.append((ni, m))
        for c in n.get('children', []):
            walk(c, m, keep)
    for root in j['scenes'][j.get('scene', 0)]['nodes']:
        walk(root, IDENT, node is None)
    if not worlds:
        raise RuntimeError(f'no meshes (node={node}) in {src}')

    groups = {}   # material -> dict of lists
    for ni, m in worlds:
        # normal matrix: inverse-transpose of the 3x3 (general)
        a = [[m[0], m[4], m[8]], [m[1], m[5], m[9]], [m[2], m[6], m[10]]]
        det = (a[0][0] * (a[1][1] * a[2][2] - a[1][2] * a[2][1]) - a[0][1] * (a[1][0] * a[2][2] - a[1][2] * a[2][0])
               + a[0][2] * (a[1][0] * a[2][1] - a[1][1] * a[2][0])) or 1e-12
        cof = [[(a[1][1] * a[2][2] - a[1][2] * a[2][1]), -(a[1][0] * a[2][2] - a[1][2] * a[2][0]), (a[1][0] * a[2][1] - a[1][1] * a[2][0])],
               [-(a[0][1] * a[2][2] - a[0][2] * a[2][1]), (a[0][0] * a[2][2] - a[0][2] * a[2][0]), -(a[0][0] * a[2][1] - a[0][1] * a[2][0])],
               [(a[0][1] * a[1][2] - a[0][2] * a[1][1]), -(a[0][0] * a[1][2] - a[0][2] * a[1][0]), (a[0][0] * a[1][1] - a[0][1] * a[1][0])]]
        nmat = [[cof[r][c] / det for c in range(3)] for r in range(3)]  # = inverse transpose
        flip = det < 0
        for p in j['meshes'][j['nodes'][ni]['mesh']]['primitives']:
            if p.get('mode', 4) != 4:
                continue
            g = groups.setdefault(p.get('material', -1), {'pos': [], 'nor': [], 'uv': [], 'tan': [], 'idx': [], 'has_tan': True})
            at = p['attributes']
            P = read(at['POSITION']); N = read(at['NORMAL']) if 'NORMAL' in at else None
            U = read(at['TEXCOORD_0']) if 'TEXCOORD_0' in at else None
            T = read(at['TANGENT']) if 'TANGENT' in at else None
            if T is None:
                g['has_tan'] = False
            I = [i[0] for i in read(p['indices'])] if 'indices' in p else list(range(len(P)))
            b0 = len(g['pos'])
            for v in P:
                g['pos'].append((m[0] * v[0] + m[4] * v[1] + m[8] * v[2] + m[12], m[1] * v[0] + m[5] * v[1] + m[9] * v[2] + m[13], m[2] * v[0] + m[6] * v[1] + m[10] * v[2] + m[14]))
            for k in range(len(P)):
                if N:
                    v = N[k]; n = [nmat[r][0] * v[0] + nmat[r][1] * v[1] + nmat[r][2] * v[2] for r in range(3)]
                    l = math.sqrt(n[0] ** 2 + n[1] ** 2 + n[2] ** 2) or 1.0
                    g['nor'].append((n[0] / l, n[1] / l, n[2] / l))
                else:
                    g['nor'].append((0.0, 1.0, 0.0))
                g['uv'].append(tuple(U[k][:2]) if U else (0.0, 0.0))
                if T:
                    v = T[k]; t = [a[r][0] * v[0] + a[r][1] * v[1] + a[r][2] * v[2] for r in range(3)]
                    l = math.sqrt(t[0] ** 2 + t[1] ** 2 + t[2] ** 2) or 1.0
                    g['tan'].append((t[0] / l, t[1] / l, t[2] / l, v[3] if len(v) > 3 else 1.0))
            for t in range(0, len(I) - 2, 3):
                tri = (I[t] + b0, I[t + 1] + b0, I[t + 2] + b0)
                g['idx'].extend((tri[0], tri[2], tri[1]) if flip else tri)

    blob = bytearray(); views = []; accs = []
    def add(data, ctype, typ, count, target, minmax=None):
        while len(blob) % 4:
            blob.append(0)
        views.append({'buffer': 0, 'byteOffset': len(blob), 'byteLength': len(data), 'target': target})
        blob.extend(data)
        a = {'bufferView': len(views) - 1, 'componentType': ctype, 'count': count, 'type': typ}
        if minmax:
            a['min'], a['max'] = minmax
        accs.append(a)
        return len(accs) - 1
    prims = []
    for mat, g in groups.items():
        n = len(g['pos'])
        mn = [min(v[i] for v in g['pos']) for i in range(3)]; mx = [max(v[i] for v in g['pos']) for i in range(3)]
        attrs = {'POSITION': add(b''.join(struct.pack('<3f', *v) for v in g['pos']), 5126, 'VEC3', n, 34962, (mn, mx)),
                 'NORMAL': add(b''.join(struct.pack('<3f', *v) for v in g['nor']), 5126, 'VEC3', n, 34962),
                 'TEXCOORD_0': add(b''.join(struct.pack('<2f', *v) for v in g['uv']), 5126, 'VEC2', n, 34962)}
        if g['has_tan'] and len(g['tan']) == n:
            attrs['TANGENT'] = add(b''.join(struct.pack('<4f', *v) for v in g['tan']), 5126, 'VEC4', n, 34962)
        idx = add(struct.pack(f'<{len(g["idx"])}I', *g['idx']), 5125, 'SCALAR', len(g['idx']), 34963)
        pr = {'attributes': attrs, 'indices': idx}
        if mat >= 0:
            pr['material'] = mat
        prims.append(pr)
    name = mesh_name or os.path.splitext(os.path.basename(dst))[0]
    binname = os.path.splitext(os.path.basename(dst))[0] + '.bin'
    out = {'asset': {'version': '2.0', 'generator': 'snowfall sf_gltf'}, 'scene': 0, 'scenes': [{'nodes': [0]}],
           'nodes': [{'name': name, 'mesh': 0}], 'meshes': [{'name': name, 'primitives': prims}],
           'accessors': accs, 'bufferViews': views, 'buffers': [{'uri': binname, 'byteLength': len(blob)}]}
    for k in ('materials', 'textures', 'images', 'samplers', 'extensionsUsed'):
        if k in j:
            out[k] = j[k]
    open(os.path.join(os.path.dirname(dst), binname), 'wb').write(bytes(blob))
    json.dump(out, open(dst, 'w', encoding='utf-8'))
    return sum(len(g['idx']) // 3 for g in groups.values())
