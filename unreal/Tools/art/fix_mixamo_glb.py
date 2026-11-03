#!/usr/bin/env python3
"""Bake the 0.01 armature scale of a Mixamo->three.js .glb into the skeleton, so Unreal imports it at real size.

  python3 Tools/art/fix_mixamo_glb.py SourceArt/Downloads/chars/Xbot.glb   -> Xbot.unit.glb next to it

Mixamo exports skin vertices in metres but bones in centimetres under an 'Armature' node scaled 0.01. Unreal's glTF
import keeps that split: SK_Xbot came out 1.6 cm tall and the game scaled it x126 at runtime, and the Shadow figure in
L_Blizzard rendered as a screen-sized black ellipse every few seconds (walk captures dk0-dk12) while otherwise being
invisible. Baking the scale (joint translations, inverse bind matrices and translation keys x0.01, armature scale 1)
gives one consistent unit system; the skinned result is mathematically identical.
"""
import json, os, struct, sys
import numpy as np

CT = {5126: np.float32}
NC = {'SCALAR': 1, 'VEC3': 3, 'VEC4': 4, 'MAT4': 16}


def load_glb(path):
    d = open(path, 'rb').read()
    jl = struct.unpack_from('<I', d, 12)[0]
    j = json.loads(d[20:20 + jl])
    off = 20 + jl
    bl = struct.unpack_from('<I', d, off)[0]
    return j, bytearray(d[off + 8: off + 8 + bl])


def save_glb(path, j, b):
    while len(b) % 4:
        b.append(0)
    j['buffers'] = [{'byteLength': len(b)}]
    js = json.dumps(j, separators=(',', ':')).encode()
    while len(js) % 4:
        js += b' '
    out = struct.pack('<III', 0x46546C67, 2, 12 + 8 + len(js) + 8 + len(b))
    out += struct.pack('<II', len(js), 0x4E4F534A) + js + struct.pack('<II', len(b), 0x004E4942) + bytes(b)
    open(path, 'wb').write(out)


def scale_accessor(j, b, ai, fn):
    """Rewrite a float accessor in place (only tightly packed float data is expected here)."""
    a = j['accessors'][ai]; bv = j['bufferViews'][a['bufferView']]
    nc = NC[a['type']]; off = bv.get('byteOffset', 0) + a.get('byteOffset', 0)
    stride = bv.get('byteStride') or 4 * nc
    assert a['componentType'] == 5126 and stride == 4 * nc, 'unexpected accessor layout'
    arr = np.frombuffer(bytes(b[off: off + a['count'] * stride]), dtype=np.float32).reshape(a['count'], nc).copy()
    arr = fn(arr).astype(np.float32)
    b[off: off + arr.nbytes] = arr.tobytes()
    if 'min' in a:
        a['min'] = arr.min(axis=0).tolist(); a['max'] = arr.max(axis=0).tolist()


def fix(path):
    j, b = load_glb(path)
    roots = [n for n in j['scenes'][j.get('scene', 0)]['nodes']]
    arm = next((r for r in roots if abs(j['nodes'][r].get('scale', [1, 1, 1])[0] - 0.01) < 1e-4), None)
    if arm is None:
        print(f'{path}: no 0.01-scaled root, nothing to do'); return None
    s = j['nodes'][arm]['scale'][0]
    joints = set()
    for sk in j.get('skins', []):
        joints.update(sk['joints'])
        if 'inverseBindMatrices' in sk:
            def ibm(m):
                # new bind pose M' = S M S^-1, so IBM' = S * IBM: scale rows 0..2 (column-major: every element but 3,7,11,15)
                m = m.copy()
                for c in range(4):
                    m[:, c * 4: c * 4 + 3] *= s
                return m
            scale_accessor(j, b, sk['inverseBindMatrices'], ibm)
    for ji in joints:
        n = j['nodes'][ji]
        if 'translation' in n:
            n['translation'] = [v * s for v in n['translation']]
    done = set()
    for an in j.get('animations', []):
        for ch in an['channels']:
            if ch['target']['path'] == 'translation' and ch['target'].get('node') in joints:
                out = an['samplers'][ch['sampler']]['output']
                if out not in done:
                    scale_accessor(j, b, out, lambda v: v * s); done.add(out)
    j['nodes'][arm]['scale'] = [1.0, 1.0, 1.0]
    # one skinned mesh per skin: Xbot ships its body ('Beta_Surface') and its ball joints ('Beta_Joints') as two
    # meshes, and Unreal imported only one of them - the Shadow showed up as a cloud of floating joints (tag ch1)
    by_skin = {}
    for ni, n in enumerate(j['nodes']):
        if 'mesh' in n and 'skin' in n:
            by_skin.setdefault(n['skin'], []).append(ni)
    for skin, nodes in by_skin.items():
        if len(nodes) > 1:
            keep = j['nodes'][nodes[0]]
            for other in nodes[1:]:
                on = j['nodes'][other]
                j['meshes'][keep['mesh']]['primitives'] += j['meshes'][on['mesh']]['primitives']
                del on['mesh']; del on['skin']
            print(f'  merged {len(nodes)} skinned meshes of skin {skin} into {j["meshes"][keep["mesh"]].get("name")}')
    dst = os.path.splitext(path)[0] + '.unit.glb'
    save_glb(dst, j, b)
    print(f'{path}: baked armature scale {s} into {len(joints)} joints, {len(done)} translation tracks -> {dst}')
    return dst


if __name__ == '__main__':
    for p in sys.argv[1:]:
        fix(p)
