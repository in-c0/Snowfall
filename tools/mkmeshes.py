# Writes small authored meshes (three.js space: metres, Y-up) as glb for the UE import.
import json, struct, math, os
OUT = '/home/claude/ue/Snowfall/SourceArt/Meshes'

def glb(path, pos, nor, uv, idx, name):
    def pack(fmt, arr): return b''.join(struct.pack(fmt, *a) if isinstance(a, (tuple, list)) else struct.pack(fmt, a) for a in arr)
    bp, bn, bu = pack('<3f', pos), pack('<3f', nor), pack('<2f', uv)
    bi = pack('<I', idx)
    bufs = [bp, bn, bu, bi]; views = []; off = 0; blob = b''
    for b in bufs:
        views.append({'buffer': 0, 'byteOffset': off, 'byteLength': len(b)}); blob += b; pad = (-len(blob)) % 4; blob += b'\0' * pad; off = len(blob)
    mn = [min(p[i] for p in pos) for i in range(3)]; mx = [max(p[i] for p in pos) for i in range(3)]
    j = {'asset': {'version': '2.0'}, 'scene': 0, 'scenes': [{'nodes': [0]}], 'nodes': [{'mesh': 0, 'name': name}],
         'meshes': [{'name': name, 'primitives': [{'attributes': {'POSITION': 0, 'NORMAL': 1, 'TEXCOORD_0': 2}, 'indices': 3}]}],
         'accessors': [{'bufferView': 0, 'componentType': 5126, 'count': len(pos), 'type': 'VEC3', 'min': mn, 'max': mx},
                       {'bufferView': 1, 'componentType': 5126, 'count': len(nor), 'type': 'VEC3'},
                       {'bufferView': 2, 'componentType': 5126, 'count': len(uv), 'type': 'VEC2'},
                       {'bufferView': 3, 'componentType': 5125, 'count': len(idx), 'type': 'SCALAR'}],
         'bufferViews': views, 'buffers': [{'byteLength': len(blob)}]}
    js = json.dumps(j).encode(); js += b' ' * ((-len(js)) % 4)
    out = struct.pack('<III', 0x46546C67, 2, 12 + 8 + len(js) + 8 + len(blob)) + struct.pack('<II', len(js), 0x4E4F534A) + js + struct.pack('<II', len(blob), 0x004E4942) + blob
    open(path, 'wb').write(out)

# Flake: a unit quad (the material billboards it); UVs drive the corners
pos = [(-0.5, -0.5, 0), (0.5, -0.5, 0), (0.5, 0.5, 0), (-0.5, 0.5, 0)]
nor = [(0, 0, 1)] * 4
uv = [(0, 0), (1, 0), (1, 1), (0, 1)]
idx = [0, 1, 2, 0, 2, 3]
glb(f'{OUT}/SM_Flake.glb', pos, nor, uv, idx, 'SM_Flake')

# Wine glass: lathe profile (radius, height) in metres, outside then inside of bowl
prof = [(0.0, 0.0), (0.037, 0.0), (0.038, 0.002), (0.012, 0.006), (0.004, 0.012), (0.0035, 0.09), (0.006, 0.098), (0.03, 0.115),
        (0.042, 0.14), (0.043, 0.17), (0.038, 0.205), (0.0365, 0.207), (0.0405, 0.17), (0.0395, 0.14), (0.028, 0.117), (0.0, 0.106)]
seg = 48
pos, nor, uv, idx = [], [], [], []
# normals from profile tangents
pn = []
for i, (r, h) in enumerate(prof):
    a = prof[max(i - 1, 0)]; b = prof[min(i + 1, len(prof) - 1)]
    dr, dh = b[0] - a[0], b[1] - a[1]; l = math.hypot(dr, dh) or 1
    pn.append((dh / l, -dr / l))
for j in range(seg + 1):
    t = j / seg * 2 * math.pi; c, s_ = math.cos(t), math.sin(t)
    for i, (r, h) in enumerate(prof):
        pos.append((r * c, h, r * s_)); nr, nh = pn[i]; nor.append((nr * c, nh, nr * s_)); uv.append((j / seg, i / (len(prof) - 1)))
n = len(prof)
for j in range(seg):
    for i in range(n - 1):
        a = j * n + i; b = (j + 1) * n + i
        idx += [a, a + 1, b, b, a + 1, b + 1]
glb(f'{OUT}/SM_WineGlass.glb', pos, nor, uv, idx, 'SM_WineGlass')
print(os.listdir(OUT))
